"""Proteção de login: rate limit por IP, lockout de conta, reset no sucesso e
Retry-After. A proteção fica desligada em testing por padrão; aqui reativamos e
baixamos os limites via monkeypatch, isolando por IP (X-Forwarded-For).

Loop/Redis: o `redis_client` é um singleton preso ao loop da 1ª operação. Cada
teste roda no seu próprio loop (função) e reatribui um pool novo no início, para
que TODAS as operações Redis (do teste e do endpoint via ASGI, no mesmo loop)
usem conexões ligadas àquele loop.
"""

import pytest_asyncio

from app.core.db import SessionLocal
from app.core.redis import redis_client
from app.core.security import hash_password
from app.models import User
from app.services import loginguard


def _reset_pool():
    """Pool Redis novo ligado ao loop atual (evita 'attached to a different loop')."""
    from redis.asyncio import ConnectionPool

    from app.core.config import get_settings

    redis_client.connection_pool = ConnectionPool.from_url(get_settings().redis_url, decode_responses=True)


@pytest_asyncio.fixture
async def guarded(monkeypatch, _schema):
    """Liga a proteção com limites baixos e backoff zero. Só faz DB+monkeypatch
    (loop-agnósticos); o Redis é tratado dentro de cada teste."""
    monkeypatch.setattr(loginguard.settings, "testing", False)
    monkeypatch.setattr(loginguard.settings, "login_protection_enabled", True)
    monkeypatch.setattr(loginguard.settings, "login_ip_max_attempts", 3)
    monkeypatch.setattr(loginguard.settings, "login_ip_window_seconds", 60)
    monkeypatch.setattr(loginguard.settings, "login_account_max_failures", 3)
    monkeypatch.setattr(loginguard.settings, "login_account_window_seconds", 60)
    monkeypatch.setattr(loginguard.settings, "login_lockout_seconds", 60)
    monkeypatch.setattr(loginguard.settings, "login_backoff_max_seconds", 0.0)
    async with SessionLocal() as s:
        from sqlalchemy import select
        u = (await s.execute(select(User).where(User.username == "lockme"))).scalar_one_or_none()
        if u is None:
            s.add(User(username="lockme", email="lockme@t.test", password_hash=hash_password("Senha@123"),
                       role="operator", org_id=None, is_active=True))
            await s.commit()
    yield


async def _login(client, username, password, ip):
    return await client.post(
        "/auth/login", data={"username": username, "password": password},
        headers={"X-Forwarded-For": ip},
    )


async def test_ip_rate_limit_returns_429_with_retry_after(client, guarded):
    _reset_pool()
    ip = "203.0.113.10"
    await redis_client.delete(loginguard._ip_key(ip))
    # Identificadores distintos por tentativa: isola o limite por IP (sem acionar
    # o lockout de conta). 3 permitidas (credencial inválida → 401).
    for i in range(3):
        r = await _login(client, f"nobody{i}@x.test", "wrong", ip)
        assert r.status_code == 401
    # A 4ª estoura o limite por IP.
    blocked = await _login(client, "nobody9@x.test", "wrong", ip)
    assert blocked.status_code == 429
    assert int(blocked.headers.get("Retry-After", "0")) >= 1
    await redis_client.delete(loginguard._ip_key(ip))


async def test_account_lockout_blocks_even_correct_password(client, guarded):
    _reset_pool()
    await redis_client.delete(loginguard._acct_key("lockme@t.test"), loginguard._lock_key("lockme@t.test"))
    # 3 falhas na conta (IPs distintos para não bater no limite por IP).
    for i in range(3):
        r = await _login(client, "lockme@t.test", "errada", f"198.51.100.{i}")
        assert r.status_code == 401
    # Conta bloqueada: mesmo com a senha correta vem 429.
    blocked = await _login(client, "lockme@t.test", "Senha@123", "198.51.100.99")
    assert blocked.status_code == 429
    assert int(blocked.headers.get("Retry-After", "0")) >= 1
    await redis_client.delete(loginguard._acct_key("lockme@t.test"), loginguard._lock_key("lockme@t.test"))


async def test_success_resets_failure_counter(client, guarded):
    _reset_pool()
    ip = "203.0.113.20"
    await redis_client.delete(loginguard._ip_key(ip), loginguard._acct_key("lockme@t.test"), loginguard._lock_key("lockme@t.test"))
    # 2 falhas (abaixo do lockout).
    for _ in range(2):
        assert (await _login(client, "lockme@t.test", "errada", ip)).status_code == 401
    # Login correto zera o contador da conta e remove o lockout.
    ok = await _login(client, "lockme@t.test", "Senha@123", ip)
    assert ok.status_code == 200
    assert await redis_client.get(loginguard._acct_key("lockme@t.test")) is None
    assert await redis_client.get(loginguard._lock_key("lockme@t.test")) is None
    await redis_client.delete(loginguard._ip_key(ip))


async def test_disabled_in_testing_by_default(client, monkeypatch, _schema):
    _reset_pool()
    # Sem reativar: proteção desligada em testing → nunca 429.
    monkeypatch.setattr(loginguard.settings, "testing", True)
    for _ in range(6):
        r = await _login(client, "ghost@x.test", "wrong", "192.0.2.50")
        assert r.status_code == 401
