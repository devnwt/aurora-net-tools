"""Meu Perfil: e-mail não editável, phone/foto editáveis, senha só com a atual."""

import pytest_asyncio
from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models import User


async def _login(client, email, pw):
    r = await client.post("/auth/login", data={"username": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest_asyncio.fixture
async def prof_user(_schema):
    async with SessionLocal() as s:
        u = (await s.execute(select(User).where(User.email == "prof@t.test"))).scalar_one_or_none()
        if u is None:
            u = User(username="prof@t.test", email="prof@t.test", role="operator", is_active=True)
            s.add(u)
        u.password_hash = hash_password("Senha@123")
        u.phone = None
        u.photo = None
        await s.commit()
    yield


async def test_profile_update_phone_photo_email_locked(client, prof_user):
    tok = await _login(client, "prof@t.test", "Senha@123")
    client.headers["Authorization"] = f"Bearer {tok}"
    me = (await client.get("/profile")).json()
    assert me["email"] == "prof@t.test"

    png = "data:image/png;base64," + "A" * 40
    body = (await client.patch("/profile", json={"phone": "(11) 90000-0000", "photo": png})).json()
    assert body["phone"] == "(11) 90000-0000" and body["photo"] == png

    # E-mail NÃO é editável (campo ignorado pelo schema).
    await client.patch("/profile", json={"email": "novo@t.test"})
    assert (await client.get("/profile")).json()["email"] == "prof@t.test"

    # Foto inválida → 400.
    assert (await client.patch("/profile", json={"photo": "notadataurl"})).status_code == 400


async def test_admin_creates_user_by_invite(client, auth_client):
    from app.core.security import create_scoped_token

    # Master cria usuário SEM senha → convite (senha vazia, sem e-mail em testes).
    r = await auth_client.post("/users", json={"email": "invited@t.test", "role": "operator"})
    assert r.status_code == 201, r.text
    uid = r.json()["id"]

    # Sem senha, o login normal falha.
    assert (await client.post("/auth/login", data={"username": "invited@t.test", "password": "qualquer"})).status_code == 401

    # Aceita o convite (token escopado, como no link do e-mail) → loga.
    tok = create_scoped_token(str(uid), purpose="invite", minutes=60)
    acc = await client.post("/auth/accept-invite", json={"token": tok})
    assert acc.status_code == 200
    client.headers["Authorization"] = f"Bearer {acc.json()['access_token']}"
    assert (await client.get("/auth/me")).json()["must_set_password"] is True

    # Define a senha inicial (sem senha atual).
    assert (await client.post("/profile/set-password", json={"new_password": "Senha@123"})).status_code == 200
    assert (await client.get("/auth/me")).json()["must_set_password"] is False

    # Agora o login normal funciona; e o convite não pode ser reutilizado.
    del client.headers["Authorization"]
    assert (await client.post("/auth/login", data={"username": "invited@t.test", "password": "Senha@123"})).status_code == 200
    assert (await client.post("/auth/accept-invite", json={"token": tok})).status_code == 400


async def test_profile_password_requires_old(client, prof_user):
    tok = await _login(client, "prof@t.test", "Senha@123")
    client.headers["Authorization"] = f"Bearer {tok}"
    # Senha atual errada → 400.
    assert (await client.post("/profile/password", json={"old_password": "errada", "new_password": "NovaSenha1"})).status_code == 400
    # Senha nova fraca → 400.
    assert (await client.post("/profile/password", json={"old_password": "Senha@123", "new_password": "abc"})).status_code == 400
    # Correta → 200.
    assert (await client.post("/profile/password", json={"old_password": "Senha@123", "new_password": "NovaSenha1"})).status_code == 200
    # Login com a nova funciona; com a antiga falha.
    del client.headers["Authorization"]
    assert (await client.post("/auth/login", data={"username": "prof@t.test", "password": "NovaSenha1"})).status_code == 200
    assert (await client.post("/auth/login", data={"username": "prof@t.test", "password": "Senha@123"})).status_code == 401
