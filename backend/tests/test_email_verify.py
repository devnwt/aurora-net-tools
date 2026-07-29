"""Login apenas por e-mail + cadastro em 3 passos:
form (register) → verifica e-mail (verify-email) → escolhe plano (complete-registration).
A conta só é criada no passo do plano, com o e-mail já verificado."""

import pytest_asyncio
from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.redis import redis_client
from app.core.security import hash_password
from app.models import Organization, User
from app.services import emailverify


def _reset_pool():
    from redis.asyncio import ConnectionPool

    from app.core.config import get_settings

    redis_client.connection_pool = ConnectionPool.from_url(get_settings().redis_url, decode_responses=True)


@pytest_asyncio.fixture
async def a_user(_schema):
    async with SessionLocal() as s:
        u = (await s.execute(select(User).where(User.username == "loginmail"))).scalar_one_or_none()
        if u is None:
            s.add(User(username="loginmail", email="login@mail.test", password_hash=hash_password("Senha@123"),
                       role="operator", org_id=None, is_active=True))
            await s.commit()
    yield


async def _seed_pending(email, needs_code=True):
    return await emailverify.start(email, {
        "org_name": "NewCo", "username": "newco_admin", "email": email,
        "password_hash": hash_password("Senha@123"),
    }, needs_code=needs_code)


async def test_login_is_email_only(client, a_user):
    assert (await client.post("/auth/login", data={"username": "login@mail.test", "password": "Senha@123"})).status_code == 200
    assert (await client.post("/auth/login", data={"username": "loginmail", "password": "Senha@123"})).status_code == 401


async def test_verify_then_complete_creates_account(client, _schema):
    _reset_pool()
    email = "newco@mail.test"
    await redis_client.delete(f"emailverify:{email}")
    code = await _seed_pending(email)

    # Código errado → 400 e NÃO cria conta.
    assert (await client.post("/auth/verify-email", json={"email": email, "code": "000000"})).status_code == 400
    # Não pode completar antes de verificar.
    assert (await client.post("/auth/complete-registration", json={"email": email, "plan_id": None})).status_code == 400

    # Código certo → 200 (só verifica, sem criar conta).
    ok = await client.post("/auth/verify-email", json={"email": email, "code": code})
    assert ok.status_code == 200
    async with SessionLocal() as s:
        assert (await s.execute(select(User).where(User.email == email))).scalar_one_or_none() is None  # ainda não

    # Escolhe o plano → cria a conta + token.
    done = await client.post("/auth/complete-registration", json={"email": email, "plan_id": None})
    assert done.status_code == 200 and done.json().get("access_token")
    async with SessionLocal() as s:
        assert (await s.execute(select(User).where(User.email == email))).scalar_one_or_none() is not None
        assert (await s.execute(select(Organization).where(Organization.name == "NewCo"))).scalar_one_or_none() is not None
    # E o login por e-mail funciona.
    assert (await client.post("/auth/login", data={"username": email, "password": "Senha@123"})).status_code == 200


async def test_complete_without_verification_is_400(client, _schema):
    _reset_pool()
    email = "unverified@mail.test"
    await redis_client.delete(f"emailverify:{email}")
    await _seed_pending(email)  # pendência não verificada
    assert (await client.post("/auth/complete-registration", json={"email": email, "plan_id": None})).status_code == 400


async def test_verify_without_pending_is_400(client, _schema):
    _reset_pool()
    assert (await client.post("/auth/verify-email", json={"email": "sem-pendencia@mail.test", "code": "123456"})).status_code == 400
