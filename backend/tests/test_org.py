"""Danger Zone — exclusão permanente da PRÓPRIA empresa (Admin da empresa).

Garante: acesso só do admin da empresa (operator/master barrados), confirmação
obrigatória, cascata (device/usuário somem) e isolamento (a outra ORG intacta).
"""

import pytest_asyncio
from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models import Device, Organization, Plan, User
from app.models.enums import DeviceType


async def _login(client, username: str, password: str) -> str:
    # Login é por e-mail; os usuários de teste usam {username}@t.test.
    res = await client.post("/auth/login", data={"username": f"{username}@t.test", "password": password})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


@pytest_asyncio.fixture
async def two_orgs(client, _schema):
    """Duas ORGs (DZ_Acme com admin+operator+device; DZ_Other com admin+device).
    Idempotente (schema session-scoped): recria o que um teste anterior apagou."""
    async def goc(s, model, where, **defaults):
        obj = (await s.execute(select(model).where(where))).scalar_one_or_none()
        if obj is None:
            obj = model(**defaults)
            s.add(obj)
            await s.flush()
        return obj

    async with SessionLocal() as s:
        plan = await goc(s, Plan, Plan.name == "DZPlan", name="DZPlan", max_devices=10, max_users=5)
        a = await goc(s, Organization, Organization.name == "DZ_Acme", name="DZ_Acme", plan_id=plan.id)
        b = await goc(s, Organization, Organization.name == "DZ_Other", name="DZ_Other", plan_id=plan.id)
        await goc(s, User, User.username == "dz_admin", username="dz_admin", email="dz_admin@t.test",
                  password_hash=hash_password("senha123"), role="admin", is_admin=True, org_id=a.id)
        await goc(s, User, User.username == "dz_op", username="dz_op", email="dz_op@t.test",
                  password_hash=hash_password("senha123"), role="operator", org_id=a.id)
        await goc(s, User, User.username == "dz_badmin", username="dz_badmin", email="dz_badmin@t.test",
                  password_hash=hash_password("senha123"), role="admin", is_admin=True, org_id=b.id)
        await goc(s, Device, Device.name == "dz_dev_a", name="dz_dev_a", ip="10.0.0.1",
                  device_type=DeviceType.routeros, org_id=a.id)
        await goc(s, Device, Device.name == "dz_dev_b", name="dz_dev_b", ip="10.0.0.2",
                  device_type=DeviceType.routeros, org_id=b.id)
        await s.commit()
        return {"a": a.id, "b": b.id}


async def test_operator_cannot_access_danger_zone(client, two_orgs):
    tok = await _login(client, "dz_op", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    assert (await client.get("/org")).status_code == 403
    assert (await client.post("/org/delete", json={"confirm": "EXCLUIR"})).status_code == 403


async def test_master_cannot_access_danger_zone(auth_client, two_orgs):
    # Master não tem ORG própria — a área é exclusiva do admin da empresa.
    assert (await auth_client.get("/org")).status_code == 403
    assert (await auth_client.post("/org/delete", json={"confirm": "EXCLUIR"})).status_code == 403


async def test_admin_sees_own_org_summary(client, two_orgs):
    tok = await _login(client, "dz_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    body = (await client.get("/org")).json()
    assert body["name"] == "DZ_Acme"
    assert body["counts"]["devices"] >= 1
    assert body["counts"]["users"] >= 2


async def test_delete_requires_valid_confirmation(client, two_orgs):
    tok = await _login(client, "dz_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    assert (await client.post("/org/delete", json={"confirm": "errado"})).status_code == 400
    # Nada foi excluído.
    assert (await client.get("/org")).status_code == 200


async def test_delete_removes_only_own_org(client, two_orgs):
    tok = await _login(client, "dz_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    # Confirma com o nome exato da empresa.
    assert (await client.post("/org/delete", json={"confirm": "DZ_Acme"})).status_code == 204
    async with SessionLocal() as s:
        # A empresa e seus dados sumiram (cascata), sem órfãos.
        assert (await s.execute(select(Organization).where(Organization.id == two_orgs["a"]))).scalar_one_or_none() is None
        assert (await s.execute(select(Device).where(Device.org_id == two_orgs["a"]))).first() is None
        assert (await s.execute(select(User).where(User.org_id == two_orgs["a"]))).first() is None
        # A outra empresa permanece intacta (sem cross-tenant).
        assert (await s.execute(select(Organization).where(Organization.id == two_orgs["b"]))).scalar_one_or_none() is not None
        assert (await s.execute(select(Device).where(Device.org_id == two_orgs["b"]))).first() is not None


async def test_delete_accepts_excluir_keyword(client, two_orgs):
    tok = await _login(client, "dz_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    assert (await client.post("/org/delete", json={"confirm": "excluir"})).status_code == 204
    async with SessionLocal() as s:
        assert (await s.execute(select(Organization).where(Organization.id == two_orgs["a"]))).scalar_one_or_none() is None
