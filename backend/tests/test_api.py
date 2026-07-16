"""Testes de integração cobrindo critérios do SPEC §11 (caminhos determinísticos)."""

import pytest

from app.drivers.classifier import classify_command
from app.models.enums import Classification, DeviceType


# === Classifier (unitário, decisão §13) ===


@pytest.mark.parametrize(
    "device_type,command,expected",
    [
        (DeviceType.routeros, "/system resource print", Classification.read),
        (DeviceType.routeros, "/ip address add address=1.2.3.4/24", Classification.write),
        (DeviceType.routeros, "/interface print", Classification.read),
        (DeviceType.cisco, "show version", Classification.read),
        (DeviceType.cisco, "configure terminal", Classification.write),
        (DeviceType.huawei, "display version", Classification.read),
        (DeviceType.routeros, "", Classification.write),  # vazio = bloqueado
        (DeviceType.cisco, "reload", Classification.write),
    ],
)
def test_classifier(device_type, command, expected):
    assert classify_command(device_type, command) == expected


# === Auth (§11: rotas protegidas) ===


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["database"] is True


async def test_requires_auth(client):
    assert (await client.get("/devices")).status_code == 401


async def test_login_and_me(auth_client):
    r = await auth_client.get("/auth/me")
    assert r.status_code == 200
    assert r.json()["username"] == "admin"


# === Credenciais: mascaramento + cifragem em repouso (§9/§11) ===


async def test_credential_secret_masked_and_encrypted(auth_client):
    r = await auth_client.post(
        "/credentials", json={"name": "ssh-noc", "kind": "ssh", "username": "noc", "secret": "s3cr3t"}
    )
    assert r.status_code == 201
    body = r.json()
    assert body["secret"] == "********"  # nunca em claro na API

    # No banco está cifrado e decifra de volta
    from sqlalchemy import select

    from app.core.crypto import decrypt
    from app.core.db import SessionLocal
    from app.models import Credential

    async with SessionLocal() as session:
        cred = (await session.execute(select(Credential).where(Credential.id == body["id"]))).scalar_one()
        assert cred.secret != "s3cr3t"
        assert cred.secret.startswith("gAAAA")  # token Fernet
        assert decrypt(cred.secret) == "s3cr3t"


# === Herança de credencial device -> grupo (§7/§11) ===


async def test_credential_inheritance(auth_client):
    cred = (await auth_client.post(
        "/credentials", json={"name": "g-ssh", "kind": "ssh", "username": "noc", "secret": "x"}
    )).json()
    group = (await auth_client.post(
        "/groups", json={"name": "POP-1", "default_ssh_credential_id": cred["id"]}
    )).json()
    device = (await auth_client.post(
        "/devices",
        json={"name": "rb1", "ip": "10.0.0.9", "device_type": "routeros", "group_id": group["id"], "ssh_enabled": True},
    )).json()

    r = await auth_client.post(f"/devices/{device['id']}/test")
    assert r.status_code == 200
    assert r.json()["results"]["ssh"]["credential"] == "g-ssh"


# === Read-only: escrita bloqueada e auditada (§4/§11/§13) ===


async def test_write_blocked_and_audited(auth_client):
    device = (await auth_client.post(
        "/devices", json={"name": "rb2", "ip": "10.0.0.10", "device_type": "routeros", "ssh_enabled": True}
    )).json()

    r = await auth_client.post(
        f"/devices/{device['id']}/exec", json={"command": "/ip address add address=1.1.1.1/24", "protocol": "ssh"}
    )
    assert r.status_code == 403

    audit = (await auth_client.get(f"/audit?target_id={device['id']}")).json()
    assert len(audit) >= 1
    assert audit[0]["classification"] == "write"
    assert audit[0]["ok"] is False


# === Catálogo de diagnósticos (§13) ===


async def test_catalog_lists_ops(auth_client):
    device = (await auth_client.post(
        "/devices", json={"name": "rb3", "ip": "10.0.0.11", "device_type": "routeros"}
    )).json()
    ops = (await auth_client.get(f"/devices/{device['id']}/catalog")).json()
    keys = {o["key"] for o in ops}
    assert "ros_system" in keys
    assert "snmp_system" in keys
