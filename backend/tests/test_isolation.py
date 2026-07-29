"""Isolamento multi-tenant: FKs de credencial/grupo/rack não cruzam ORGs.

Cobre TEN-001/TEN-002 (attach cross-tenant) e TEN-003 (DELETE credential com ownership).
"""

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.core.crypto import encrypt
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models import Credential, Device, DeviceGroup, Organization, Plan, Rack, User
from app.models.enums import DeviceType, Protocol
from app.services.credentials import CredentialNotFound, resolve_credential


async def _login(client, username: str, password: str) -> str:
    res = await client.post("/auth/login", data={"username": f"{username}@t.test", "password": password})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


@pytest_asyncio.fixture
async def tenants(client, _schema):
    """Duas ORGs com admin, credencial, site (grupo) e rack cada."""

    async def goc(s, model, where, **defaults):
        obj = (await s.execute(select(model).where(where))).scalar_one_or_none()
        if obj is None:
            obj = model(**defaults)
            s.add(obj)
            await s.flush()
        return obj

    async with SessionLocal() as s:
        plan = await goc(s, Plan, Plan.name == "IsoPlan", name="IsoPlan", max_devices=50, max_users=10)
        a = await goc(s, Organization, Organization.name == "Iso_A", name="Iso_A", plan_id=plan.id)
        b = await goc(s, Organization, Organization.name == "Iso_B", name="Iso_B", plan_id=plan.id)
        await goc(
            s, User, User.username == "iso_a",
            username="iso_a", email="iso_a@t.test",
            password_hash=hash_password("senha123"), role="admin", is_admin=True, org_id=a.id,
        )
        await goc(
            s, User, User.username == "iso_b",
            username="iso_b", email="iso_b@t.test",
            password_hash=hash_password("senha123"), role="admin", is_admin=True, org_id=b.id,
        )
        cred_a = await goc(
            s, Credential, Credential.name == "cred_a",
            name="cred_a", kind="ssh", username="a", secret=encrypt("secret-a"), org_id=a.id,
        )
        cred_b = await goc(
            s, Credential, Credential.name == "cred_b",
            name="cred_b", kind="ssh", username="b", secret=encrypt("secret-b"), org_id=b.id,
        )
        site_a = await goc(s, DeviceGroup, DeviceGroup.name == "site_a", name="site_a", org_id=a.id)
        site_b = await goc(s, DeviceGroup, DeviceGroup.name == "site_b", name="site_b", org_id=b.id)
        rack_a = await goc(
            s, Rack, Rack.name == "rack_a", name="rack_a", site_id=site_a.id, org_id=a.id,
        )
        rack_b = await goc(
            s, Rack, Rack.name == "rack_b", name="rack_b", site_id=site_b.id, org_id=b.id,
        )
        await s.commit()
        return {
            "a": {"org": a.id, "cred": cred_a.id, "site": site_a.id, "rack": rack_a.id},
            "b": {"org": b.id, "cred": cred_b.id, "site": site_b.id, "rack": rack_b.id},
        }


async def test_device_rejects_foreign_credential(client, tenants):
    tok = await _login(client, "iso_a", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    res = await client.post(
        "/devices",
        json={
            "name": "iso_dev_bad_cred",
            "ip": "10.10.1.1",
            "device_type": "routeros",
            "ssh_credential_id": tenants["b"]["cred"],
        },
    )
    assert res.status_code == 404


async def test_device_accepts_own_credential(client, tenants):
    tok = await _login(client, "iso_a", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    res = await client.post(
        "/devices",
        json={
            "name": "iso_dev_ok_cred",
            "ip": "10.10.1.2",
            "device_type": "routeros",
            "ssh_credential_id": tenants["a"]["cred"],
        },
    )
    assert res.status_code == 201, res.text
    assert res.json()["ssh_credential_id"] == tenants["a"]["cred"]


async def test_device_rejects_foreign_group(client, tenants):
    tok = await _login(client, "iso_a", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    res = await client.post(
        "/devices",
        json={
            "name": "iso_dev_bad_group",
            "ip": "10.10.1.3",
            "device_type": "routeros",
            "group_id": tenants["b"]["site"],
        },
    )
    assert res.status_code == 404


async def test_device_rejects_foreign_rack(client, tenants):
    tok = await _login(client, "iso_a", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    res = await client.post(
        "/devices",
        json={
            "name": "iso_dev_bad_rack",
            "ip": "10.10.1.4",
            "device_type": "routeros",
            "rack_id": tenants["b"]["rack"],
        },
    )
    assert res.status_code == 404


async def test_device_patch_rejects_foreign_credential(client, tenants):
    tok = await _login(client, "iso_a", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    created = await client.post(
        "/devices",
        json={"name": "iso_dev_patch", "ip": "10.10.1.5", "device_type": "routeros"},
    )
    assert created.status_code == 201, created.text
    device_id = created.json()["id"]
    res = await client.patch(f"/devices/{device_id}", json={"ssh_credential_id": tenants["b"]["cred"]})
    assert res.status_code == 404


async def test_group_rejects_foreign_default_credential(client, tenants):
    tok = await _login(client, "iso_a", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    res = await client.post(
        "/groups",
        json={"name": "iso_grp_bad", "default_ssh_credential_id": tenants["b"]["cred"]},
    )
    assert res.status_code == 404


async def test_controller_rejects_foreign_credential(client, tenants):
    tok = await _login(client, "iso_a", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    res = await client.post(
        "/controllers",
        json={
            "name": "iso_ctrl_bad",
            "kind": "fiberhome_unm2000",
            "host": "10.10.2.1",
            "port": 3337,
            "credential_id": tenants["b"]["cred"],
        },
    )
    assert res.status_code == 404


async def test_rack_patch_rejects_foreign_site(client, tenants):
    tok = await _login(client, "iso_a", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    res = await client.patch(
        f"/racks/{tenants['a']['rack']}",
        json={"site_id": tenants["b"]["site"]},
    )
    assert res.status_code == 404


async def test_delete_credential_requires_ownership(client, tenants):
    tok = await _login(client, "iso_a", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    # Credencial da outra ORG não é deletável (404, não vaza existência).
    assert (await client.delete(f"/credentials/{tenants['b']['cred']}")).status_code == 404
    # A própria some.
    assert (await client.delete(f"/credentials/{tenants['a']['cred']}")).status_code == 204


async def test_resolve_credential_blocks_cross_tenant_fk(tenants, _schema):
    """Mesmo com FK envenenado no banco, resolve_credential não devolve o segredo."""
    async with SessionLocal() as s:
        device = Device(
            name="iso_poisoned",
            ip="10.10.1.99",
            device_type=DeviceType.routeros,
            org_id=tenants["a"]["org"],
            ssh_credential_id=tenants["b"]["cred"],  # FK cross-tenant forçado
        )
        s.add(device)
        await s.commit()
        await s.refresh(device)
        with pytest.raises(CredentialNotFound):
            await resolve_credential(s, device, Protocol.ssh)
