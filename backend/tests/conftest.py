"""Fixtures de teste — usa um banco Postgres dedicado (aurora_test).

Define as variáveis de ambiente ANTES de importar a app, para que o engine
aponte para o banco de teste. Cria o schema via metadata (sem Alembic) e limpa
ao final.
"""

import os

os.environ.setdefault("APP_SECRET_KEY", "test-secret")
os.environ.setdefault("JWT_SECRET", "test-jwt")
os.environ["ADMIN_PASSWORD"] = ""  # evita seed automático nos testes
os.environ["TESTING"] = "1"  # NullPool — evita conexões presas a um event loop
# FORÇA o banco de teste (não usa setdefault: o env_file do compose já define
# POSTGRES_DB=aurora e setdefault não sobrescreveria — o que apagaria o banco real).
os.environ["POSTGRES_DB"] = "aurora_test"

# Trava de segurança: jamais rodar os testes (que fazem drop_all) fora de um banco *test*.
if "test" not in os.environ["POSTGRES_DB"].lower():
    raise RuntimeError(
        f"Recusando rodar testes em POSTGRES_DB={os.environ['POSTGRES_DB']!r} — use um banco *test*."
    )

import pytest_asyncio
from httpx import ASGITransport, AsyncClient


@pytest_asyncio.fixture(autouse=True)
async def _redis_loop_isolation():
    """O `redis_client` é um singleton criado no import e prende o event loop; o
    pytest usa loops distintos por teste, então um pool cacheado por um teste
    anterior (ex.: o ping do /health) quebra os seguintes com "attached to a
    different loop". Reatribui um pool novo (sem conexões) antes de cada teste —
    ele se liga ao loop atual só na 1ª operação."""
    from redis.asyncio import ConnectionPool

    from app.core import redis as redis_mod
    from app.core.config import get_settings

    redis_mod.redis_client.connection_pool = ConnectionPool.from_url(
        get_settings().redis_url, decode_responses=True
    )
    yield


@pytest_asyncio.fixture(scope="session")
async def _schema():
    import asyncpg

    host = os.environ.get("POSTGRES_HOST", "postgres")
    port = int(os.environ.get("POSTGRES_PORT", "5432"))
    user = os.environ.get("POSTGRES_USER", "aurora")
    password = os.environ.get("POSTGRES_PASSWORD", "aurora")
    test_db = os.environ["POSTGRES_DB"]

    sys_conn = await asyncpg.connect(host=host, port=port, user=user, password=password, database="postgres")
    exists = await sys_conn.fetchval("SELECT 1 FROM pg_database WHERE datname=$1", test_db)
    if not exists:
        await sys_conn.execute(f'CREATE DATABASE "{test_db}"')
    await sys_conn.close()

    import app.models  # noqa: F401
    from app.core.db import Base, engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def admin(_schema):
    """Cria um usuário admin conhecido."""
    from sqlalchemy import select

    from app.core.db import SessionLocal
    from app.core.security import hash_password
    from app.models import User

    async with SessionLocal() as session:
        existing = (await session.execute(select(User).where(User.username == "admin"))).scalar_one_or_none()
        if existing is None:
            session.add(User(username="admin", email="admin@t.test", password_hash=hash_password("admin"), is_admin=True, role="master"))
            await session.commit()
    return {"username": "admin", "email": "admin@t.test", "password": "admin"}


@pytest_asyncio.fixture
async def client(_schema):
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def auth_client(client, admin):
    res = await client.post("/auth/login", data={"username": admin["email"], "password": admin["password"]})
    token = res.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"
    return client
