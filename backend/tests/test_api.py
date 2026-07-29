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
    # O e-mail é o identificador (sem username exposto).
    assert r.json()["email"] == "admin@t.test"


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


# === Cadastro de device: IPv4 válido + IP único por ORG ===


async def test_device_rejects_invalid_ipv4(auth_client):
    # Inclui zeros à esquerda: o Python os recusa (ambiguidade com octal), o que
    # é justamente o comportamento seguro que queremos.
    for bad in ["não-é-ip", "10.0.0.999", "1.2.3", "192.168.0.1/24", "10.0.0.01", ""]:
        r = await auth_client.post("/devices", json={"name": "x", "ip": bad, "device_type": "routeros"})
        assert r.status_code == 422, f"{bad!r} deveria ser recusado"


async def test_device_trims_whitespace_ipv4(auth_client):
    r = await auth_client.post("/devices", json={"name": "trim", "ip": "  10.0.1.5  ", "device_type": "routeros"})
    assert r.status_code == 201
    assert r.json()["ip"] == "10.0.1.5"


async def test_device_duplicate_ip_blocked(auth_client):
    first = await auth_client.post("/devices", json={"name": "a", "ip": "172.16.5.5", "device_type": "routeros"})
    assert first.status_code == 201

    dup = await auth_client.post("/devices", json={"name": "b", "ip": "172.16.5.5", "device_type": "routeros"})
    assert dup.status_code == 409

    # Espaços em volta não driblam a checagem (compara já normalizado).
    dup2 = await auth_client.post("/devices", json={"name": "c", "ip": " 172.16.5.5 ", "device_type": "cisco"})
    assert dup2.status_code == 409


async def test_device_update_ip_conflict_but_self_ok(auth_client):
    a = (await auth_client.post("/devices", json={"name": "a", "ip": "192.0.2.10", "device_type": "routeros"})).json()
    b = (await auth_client.post("/devices", json={"name": "b", "ip": "192.0.2.11", "device_type": "routeros"})).json()

    # Mover B para o IP de A é recusado.
    assert (await auth_client.patch(f"/devices/{b['id']}", json={"ip": "192.0.2.10"})).status_code == 409
    # Salvar A com o próprio IP (sem trocar) passa — o self é excluído da checagem.
    assert (await auth_client.patch(f"/devices/{a['id']}", json={"ip": "192.0.2.10"})).status_code == 200
    # IPv4 inválido no update também é barrado.
    assert (await auth_client.patch(f"/devices/{a['id']}", json={"ip": "10.0.0.256"})).status_code == 422


# === Usuário: telefone + conta ativa (bloqueia login) ===


async def test_user_phone_and_active_fields(auth_client):
    r = await auth_client.post("/users", json={
        "username": "u_phone", "email": "u_phone@example.test", "password": "Senha12345",
        "phone": "(11) 91234-5678", "role": "operator",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["phone"] == "(11) 91234-5678"
    assert body["is_active"] is True


async def test_inactive_user_cannot_login(auth_client, client):
    created = (await auth_client.post("/users", json={
        "username": "u_inactive", "email": "u_inactive@example.test", "password": "Senha12345", "role": "operator",
    })).json()

    # Ativo: loga normalmente (login é por e-mail).
    ok = await client.post("/auth/login", data={"username": "u_inactive@example.test", "password": "Senha12345"})
    assert ok.status_code == 200

    # Desativa e o login passa a ser 403.
    assert (await auth_client.patch(f"/users/{created['id']}", json={"is_active": False})).status_code == 200
    denied = await client.post("/auth/login", data={"username": "u_inactive@example.test", "password": "Senha12345"})
    assert denied.status_code == 403

    # Token emitido antes também para de valer.
    token = ok.json()["access_token"]
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 403


async def test_cannot_deactivate_self(auth_client):
    me = (await auth_client.get("/auth/me")).json()
    r = await auth_client.patch(f"/users/{me['id']}", json={"is_active": False})
    assert r.status_code == 400


# === Catálogo de diagnósticos (§13) ===


async def test_catalog_lists_ops(auth_client):
    device = (await auth_client.post(
        "/devices", json={"name": "rb3", "ip": "10.0.0.11", "device_type": "routeros"}
    )).json()
    ops = (await auth_client.get(f"/devices/{device['id']}/catalog")).json()
    keys = {o["key"] for o in ops}
    assert "ros_system" in keys
    assert "snmp_system" in keys
