"""Orquestrador de execução: resolve credencial, classifica, trava, executa e audita.

Centraliza a política read-only (§4/§13) e a auditoria (§11) para que tanto a API
REST quanto o MCP usem exatamente o mesmo caminho.
"""

import time

from sqlalchemy.ext.asyncio import AsyncSession

from app.drivers import snmp as snmp_driver
from app.drivers import ssh as ssh_driver
from app.drivers.base import DriverError, WriteBlocked
from app.drivers.classifier import classify_command
from app.models import Device
from app.models.enums import Classification, Protocol, TargetKind
from app.services import audit
from app.services.connlock import target_lock
from app.services.credentials import resolve_credential


async def exec_command(
    session: AsyncSession, *, actor: str, device: Device, protocol: Protocol, command: str
) -> str:
    """Executa um comando SSH/Telnet read-only. Bloqueia e audita escrita."""
    classification = classify_command(device.device_type, command)

    if classification == Classification.write:
        await audit.record(
            session, actor=actor, target_kind=TargetKind.device, target_id=device.id, org_id=device.org_id,
            protocol=protocol, command=command, classification=Classification.write,
            ok=False, error="escrita desabilitada no MVP", duration_ms=0,
        )
        raise WriteBlocked("escrita desabilitada no MVP; comando recusado pela allowlist read-only")

    credential = await resolve_credential(session, device, protocol)

    start = time.monotonic()
    try:
        async with target_lock(TargetKind.device.value, device.id):
            output = await ssh_driver.run(device, credential, command, protocol)
    except Exception as e:
        await audit.record(
            session, actor=actor, target_kind=TargetKind.device, target_id=device.id, org_id=device.org_id,
            protocol=protocol, command=command, classification=Classification.read,
            ok=False, error=str(e), duration_ms=int((time.monotonic() - start) * 1000),
        )
        raise

    await audit.record(
        session, actor=actor, target_kind=TargetKind.device, target_id=device.id, org_id=device.org_id,
        protocol=protocol, command=command, classification=Classification.read,
        ok=True, error=None, duration_ms=int((time.monotonic() - start) * 1000), output=output,
    )
    return output


async def exec_many(
    session: AsyncSession, *, actor: str, device: Device, protocol: Protocol, commands: list[str]
) -> list[str]:
    """Roda vários comandos de leitura numa única sessão SSH (1 lock, 1 conexão).

    Bloqueia tudo se QUALQUER comando for de escrita. Audita o conjunto uma vez.
    """
    for command in commands:
        if classify_command(device.device_type, command) == Classification.write:
            await audit.record(
                session, actor=actor, target_kind=TargetKind.device, target_id=device.id, org_id=device.org_id,
                protocol=protocol, command=command, classification=Classification.write,
                ok=False, error="escrita desabilitada no MVP", duration_ms=0,
            )
            raise WriteBlocked("escrita desabilitada no MVP; comando recusado pela allowlist read-only")

    credential = await resolve_credential(session, device, protocol)
    summary = "; ".join(commands)

    start = time.monotonic()
    try:
        async with target_lock(TargetKind.device.value, device.id):
            outputs = await ssh_driver.run_many(device, credential, commands, protocol)
    except Exception as e:
        await audit.record(
            session, actor=actor, target_kind=TargetKind.device, target_id=device.id, org_id=device.org_id,
            protocol=protocol, command=summary, classification=Classification.read,
            ok=False, error=str(e), duration_ms=int((time.monotonic() - start) * 1000),
        )
        raise

    await audit.record(
        session, actor=actor, target_kind=TargetKind.device, target_id=device.id, org_id=device.org_id,
        protocol=protocol, command=summary, classification=Classification.read,
        ok=True, error=None, duration_ms=int((time.monotonic() - start) * 1000),
        output=f"{len(commands)} comando(s)",
    )
    return outputs


async def exec_write(
    session: AsyncSession, *, actor: str, device: Device, protocol: Protocol, command: str
) -> str:
    """Executa um comando de ESCRITA (montado pelo servidor, não arbitrário).

    Usado só pelos endpoints estruturados de gestão (IP/DHCP), que constroem o
    comando a partir de campos validados. Audita como `write` (executado).
    """
    credential = await resolve_credential(session, device, protocol)
    start = time.monotonic()
    try:
        async with target_lock(TargetKind.device.value, device.id):
            output = await ssh_driver.run(device, credential, command, protocol)
    except Exception as e:
        await audit.record(
            session, actor=actor, target_kind=TargetKind.device, target_id=device.id, org_id=device.org_id,
            protocol=protocol, command=command, classification=Classification.write,
            ok=False, error=str(e), duration_ms=int((time.monotonic() - start) * 1000),
        )
        raise

    # RouterOS reporta erro na própria saída (ex.: "failure:", "no such item").
    low = (output or "").lower()
    ok = not any(m in low for m in ("failure", "no such item", "error", "expected", "invalid"))
    await audit.record(
        session, actor=actor, target_kind=TargetKind.device, target_id=device.id, org_id=device.org_id,
        protocol=protocol, command=command, classification=Classification.write,
        ok=ok, error=None if ok else output.strip()[:480], duration_ms=int((time.monotonic() - start) * 1000),
        output=output,
    )
    if not ok:
        raise DriverError(output.strip() or "comando recusado pelo RouterOS")
    return output


async def exec_snmp(
    session: AsyncSession, *, actor: str, device: Device, oid: str, walk: bool
) -> list[dict]:
    """SNMP get/walk — inerentemente leitura (decisão §6)."""
    credential = await resolve_credential(session, device, Protocol.snmp)
    command = snmp_driver.command_preview(device, oid, walk)

    start = time.monotonic()
    try:
        async with target_lock(TargetKind.device.value, device.id):
            if walk:
                records = await snmp_driver.snmp_walk(device, credential, oid)
            else:
                records = await snmp_driver.snmp_get(device, credential, oid)
    except Exception as e:
        await audit.record(
            session, actor=actor, target_kind=TargetKind.device, target_id=device.id, org_id=device.org_id,
            protocol=Protocol.snmp, command=command, classification=Classification.read,
            ok=False, error=str(e), duration_ms=int((time.monotonic() - start) * 1000),
        )
        raise

    await audit.record(
        session, actor=actor, target_kind=TargetKind.device, target_id=device.id, org_id=device.org_id,
        protocol=Protocol.snmp, command=command, classification=Classification.read,
        ok=True, error=None, duration_ms=int((time.monotonic() - start) * 1000),
        output=f"{len(records)} registro(s)",
    )
    return records
