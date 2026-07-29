"""AUTH-002 — revogação de sessão: denylist, refresh, logout-all, token_version."""

import pytest_asyncio
from jose import jwt
from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models import User


@pytest_asyncio.fixture
async def sess_user(client, _schema):
    async with SessionLocal() as s:
        existing = (await s.execute(select(User).where(User.username == "sessuser"))).scalar_one_or_none()
        if existing is None:
            s.add(
                User(
                    username="sessuser",
                    email="sessuser@t.test",
                    password_hash=hash_password("Senha@123"),
                    role="operator",
                    is_active=True,
                    token_version=0,
                )
            )
            await s.commit()
    return {"email": "sessuser@t.test", "password": "Senha@123"}


async def _login(client, email: str, password: str) -> dict:
    res = await client.post("/auth/login", data={"username": email, "password": password})
    assert res.status_code == 200, res.text
    body = res.json()
    assert "access_token" in body and "refresh_token" in body
    assert "jti" in jwt.get_unverified_claims(body["access_token"])
    # API tests usam Bearer; cookies do Set-Cookie no jar disparariam CSRF sem header.
    client.cookies.clear()
    return body


async def test_login_returns_refresh_pair(client, sess_user):
    body = await _login(client, sess_user["email"], sess_user["password"])
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == get_settings().jwt_expire_minutes * 60


async def test_logout_denies_access_token(client, sess_user):
    body = await _login(client, sess_user["email"], sess_user["password"])
    client.headers["Authorization"] = f"Bearer {body['access_token']}"
    assert (await client.get("/auth/me")).status_code == 200
    assert (await client.post("/auth/logout", json={"refresh_token": body["refresh_token"]})).status_code == 200
    assert (await client.get("/auth/me")).status_code == 401


async def test_refresh_rotates_and_invalidates_old_refresh(client, sess_user):
    body = await _login(client, sess_user["email"], sess_user["password"])
    old_refresh = body["refresh_token"]
    old_access = body["access_token"]
    res = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert res.status_code == 200, res.text
    new = res.json()
    assert new["access_token"] != old_access
    assert new["refresh_token"] != old_refresh
    client.cookies.clear()  # Set-Cookie do refresh não deve mascarar o 401
    # Refresh antigo não reutiliza.
    assert (await client.post("/auth/refresh", json={"refresh_token": old_refresh})).status_code == 401
    # Access antigo do par fica na denylist.
    client.headers["Authorization"] = f"Bearer {old_access}"
    assert (await client.get("/auth/me")).status_code == 401
    # Novo access funciona.
    client.headers["Authorization"] = f"Bearer {new['access_token']}"
    assert (await client.get("/auth/me")).status_code == 200


async def test_logout_all_invalidates_all_sessions(client, sess_user):
    a = await _login(client, sess_user["email"], sess_user["password"])
    b = await _login(client, sess_user["email"], sess_user["password"])
    client.headers["Authorization"] = f"Bearer {a['access_token']}"
    assert (await client.post("/auth/logout-all")).status_code == 200
    client.headers["Authorization"] = f"Bearer {a['access_token']}"
    assert (await client.get("/auth/me")).status_code == 401
    client.headers["Authorization"] = f"Bearer {b['access_token']}"
    assert (await client.get("/auth/me")).status_code == 401
    assert (await client.post("/auth/refresh", json={"refresh_token": a["refresh_token"]})).status_code == 401
    assert (await client.post("/auth/refresh", json={"refresh_token": b["refresh_token"]})).status_code == 401


async def test_password_change_bumps_sessions(client, sess_user):
    body = await _login(client, sess_user["email"], sess_user["password"])
    client.headers["Authorization"] = f"Bearer {body['access_token']}"
    res = await client.post(
        "/profile/password",
        json={"old_password": "Senha@123", "new_password": "Nova@123"},
    )
    assert res.status_code == 200, res.text
    assert (await client.get("/auth/me")).status_code == 401
    # Login com a nova senha.
    new = await _login(client, sess_user["email"], "Nova@123")
    client.headers["Authorization"] = f"Bearer {new['access_token']}"
    assert (await client.get("/auth/me")).status_code == 200
    # Restaura senha para outros testes da sessão (schema session-scoped).
    await client.post("/profile/password", json={"old_password": "Nova@123", "new_password": "Senha@123"})


async def test_legacy_token_without_jti_rejected(client, sess_user, _schema):
    """Tokens antigos (sem jti) não autenticam após o deploy."""
    settings = get_settings()
    legacy = jwt.encode(
        {"sub": "sessuser", "exp": 9999999999},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    client.headers["Authorization"] = f"Bearer {legacy}"
    assert (await client.get("/auth/me")).status_code == 401


async def test_web_login_sets_httponly_cookies_without_body_tokens(client, sess_user):
    """Cliente web: Set-Cookie HttpOnly e body sem access/refresh (AUTH-003)."""
    res = await client.post(
        "/auth/login",
        data={"username": sess_user["email"], "password": sess_user["password"]},
        headers={"X-Aurora-Client": "web"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body.get("ok") is True
    assert "access_token" not in body
    assert "refresh_token" not in body
    assert "aurora_at" in res.cookies
    assert "aurora_rt" in res.cookies
    # Cookie autentica sem Authorization.
    client.cookies.set("aurora_at", res.cookies["aurora_at"])
    client.cookies.set("aurora_rt", res.cookies["aurora_rt"])
    client.headers["X-Aurora-Client"] = "web"
    if "Authorization" in client.headers:
        del client.headers["Authorization"]
    assert (await client.get("/auth/me")).status_code == 200


async def test_cookie_mutation_without_client_header_is_csrf_rejected(client, sess_user):
    body = await _login(client, sess_user["email"], sess_user["password"])
    # Simula sessão só por cookie (sem Bearer) — CSRF exige X-Aurora-Client.
    client.cookies.set("aurora_at", body["access_token"])
    client.cookies.set("aurora_rt", body["refresh_token"])
    if "Authorization" in client.headers:
        del client.headers["Authorization"]
    res = await client.post("/auth/logout-all", json={})
    assert res.status_code == 403
    assert "CSRF" in res.json()["detail"]


async def test_cookie_refresh_with_web_header(client, sess_user):
    login = await client.post(
        "/auth/login",
        data={"username": sess_user["email"], "password": sess_user["password"]},
        headers={"X-Aurora-Client": "web"},
    )
    assert login.status_code == 200
    client.cookies.set("aurora_at", login.cookies["aurora_at"])
    client.cookies.set("aurora_rt", login.cookies["aurora_rt"])
    client.headers["X-Aurora-Client"] = "web"
    if "Authorization" in client.headers:
        del client.headers["Authorization"]
    refreshed = await client.post("/auth/refresh", json={})
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json().get("ok") is True
    assert "aurora_at" in refreshed.cookies