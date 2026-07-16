"""Poller de status RouterOS — preenche `device_status` em background.

Por ciclo, consulta cada device RouterOS (system+health numa sessão) e grava o
último snapshot. Cede a vez a execuções do usuário: se o device estiver travado
(`TargetBusy`), pula e tenta no próximo ciclo. Não audita (é automático).
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.drivers import routeros
from app.drivers import ssh as ssh_driver
from app.drivers.base import DriverError
from app.models import Device, DeviceSample, DeviceStatus
from app.models.enums import DeviceType, Protocol
from app.services import webhooks
from app.services.connlock import TargetBusy, target_lock
from app.services.credentials import CredentialNotFound, resolve_credential

log = logging.getLogger("aurora.poller")
settings = get_settings()


async def _upsert(session, device_id: int, **fields) -> str | None:
    """Faz upsert do status e devolve o status ANTERIOR (para detectar transição)."""
    row = (
        await session.execute(select(DeviceStatus).where(DeviceStatus.device_id == device_id))
    ).scalar_one_or_none()
    old = row.status if row else None
    fields["checked_at"] = datetime.now(timezone.utc)
    if row is None:
        session.add(DeviceStatus(device_id=device_id, **fields))
    else:
        for k, v in fields.items():
            setattr(row, k, v)
    await session.commit()
    return old


def _event(old: str | None, new: str) -> str | None:
    if old is None or old == new:
        return None
    if new == "online":
        return "device.online"
    if new in ("not_accessible", "offline"):
        return "device.offline"
    return None


def _notify(device: Device, old: str | None, new: str) -> None:
    ev = _event(old, new)
    if ev:
        payload = {"device": {"id": device.id, "name": device.name, "ip": device.ip}, "old_status": old, "new_status": new}
        asyncio.create_task(webhooks.dispatch(ev, payload, device.org_id))


def _protocol(device: Device) -> Protocol | None:
    if device.ssh_enabled:
        return Protocol.ssh
    if device.telnet_enabled:
        return Protocol.telnet
    return None


def _int(v) -> int | None:
    try:
        return int(float(str(v).strip()))
    except (ValueError, TypeError):
        return None


def _float(v) -> float | None:
    try:
        return float(str(v).strip())
    except (ValueError, TypeError):
        return None


async def poll_device(device: Device) -> None:
    async with SessionLocal() as session:
        proto = _protocol(device)
        if proto is None:
            await _upsert(session, device.id, status="disabled", error="sem SSH/Telnet habilitado")
            return
        try:
            credential = await resolve_credential(session, device, proto)
        except CredentialNotFound as e:
            _notify(device, await _upsert(session, device.id, status="not_accessible", error=str(e)), "not_accessible")
            return
        try:
            async with target_lock("device", device.id):
                out = await ssh_driver.run_many(
                    device, credential, [routeros.CMD_RESOURCE_BOARD, routeros.CMD_HEALTH], proto
                )
        except TargetBusy:
            return  # em uso por uma execução do usuário; tenta no próximo ciclo
        except DriverError as e:
            _notify(device, await _upsert(session, device.id, status="not_accessible", error=str(e)[:480]), "not_accessible")
            return

        s = routeros.summarize_system(routeros.parse_props(out[0]), routeros.health_temperature(out[1]))
        old = await _upsert(
            session,
            device.id,
            status="online",
            error=None,
            cpu_load=s["cpu_load"],
            ram_used_pct=s["ram_used_pct"],
            temperature=s["temperature"],
            uptime=s["uptime"],
            version=s["version"],
            board=s["board"],
            current_firmware=s["current_firmware"],
            upgrade_firmware=s["upgrade_firmware"],
        )
        # Amostra para os gráficos de Health (série temporal).
        session.add(
            DeviceSample(
                device_id=device.id,
                ts=datetime.now(timezone.utc),
                cpu_load=_int(s["cpu_load"]),
                ram_used_pct=s["ram_used_pct"],
                temperature=_float(s["temperature"]),
            )
        )
        await session.commit()
        _notify(device, old, "online")


async def _prune_samples() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.sample_retention_days)
    async with SessionLocal() as session:
        await session.execute(delete(DeviceSample).where(DeviceSample.ts < cutoff))
        await session.commit()


async def poll_once() -> None:
    async with SessionLocal() as session:
        devices = (
            await session.execute(select(Device).where(Device.device_type == DeviceType.routeros))
        ).scalars().all()
    if not devices:
        return
    try:
        await _prune_samples()
    except Exception as e:
        log.warning("prune de amostras falhou: %s", e)
    sem = asyncio.Semaphore(settings.poll_concurrency)

    async def guarded(d: Device) -> None:
        async with sem:
            try:
                await poll_device(d)
            except Exception as e:  # nunca derruba o ciclo por causa de um device
                log.warning("poll falhou em device %s: %s", d.id, e)

    await asyncio.gather(*(guarded(d) for d in devices))


async def run_poller() -> None:
    log.info("poller iniciado (intervalo=%ss, concorrência=%s)", settings.poll_interval_seconds, settings.poll_concurrency)
    await asyncio.sleep(5)  # deixa o app subir antes do 1º ciclo
    while True:
        try:
            await poll_once()
        except Exception as e:
            log.warning("ciclo do poller falhou: %s", e)
        await asyncio.sleep(settings.poll_interval_seconds)
