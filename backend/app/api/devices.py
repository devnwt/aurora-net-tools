import asyncio
import re
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.tenancy import is_master, new_org_id, owned, scope
from app.core.db import get_session
from app.drivers.base import DriverError, WriteBlocked
from app.models import Device, DeviceSample, DeviceStatus, Organization, Plan, User
from app.models.enums import DeviceType, Protocol
from app.schemas.device import DeviceCreate, DeviceOut, DeviceUpdate
from app.schemas.exec import ExecRequest, ExecResponse, SnmpRequest, SnmpResponse, TestResponse
from app.services import runner
from app.services.connlock import TargetBusy
from app.services.credentials import CredentialNotFound, resolve_credential

router = APIRouter(prefix="/devices", tags=["devices"], dependencies=[Depends(get_current_user)])


async def _get(session: AsyncSession, device_id: int, user: User) -> Device:
    d = (await session.execute(select(Device).where(Device.id == device_id))).scalar_one_or_none()
    return owned(d, user)


@router.get("/{device_id}/ping")
async def ping(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    """Ping ICMP do servidor até o IP do device (latência + perda)."""
    device = await _get(session, device_id, user)
    host = (device.ip or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9.:_-]+", host):
        raise HTTPException(400, "IP/host do device inválido")
    result = {"ok": True, "host": host, "alive": False, "loss_pct": 100.0, "avg_ms": None, "min_ms": None, "max_ms": None}
    try:
        proc = await asyncio.create_subprocess_exec(
            "ping", "-n", "-c", "3", "-W", "2", host,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=12)
    except (TimeoutError, FileNotFoundError):
        return result
    text = out.decode("utf-8", "replace")
    m = re.search(r"(\d+(?:\.\d+)?)% packet loss", text)
    if m:
        result["loss_pct"] = float(m.group(1))
    r = re.search(r"=\s*([\d.]+)/([\d.]+)/([\d.]+)/", text)
    if r:
        result["min_ms"], result["avg_ms"], result["max_ms"] = float(r.group(1)), float(r.group(2)), float(r.group(3))
    result["alive"] = result["loss_pct"] < 100
    return result


async def _device_limit(session: AsyncSession, org_id: int) -> int:
    org = (await session.execute(select(Organization).where(Organization.id == org_id))).scalar_one_or_none()
    if org is None:
        return 0
    if org.device_limit is not None:
        return org.device_limit
    if org.plan_id is not None:
        plan = (await session.execute(select(Plan).where(Plan.id == org.plan_id))).scalar_one_or_none()
        if plan is not None:
            return plan.max_devices
    return 0  # sem plano/limite definido → bloqueia criação


@router.get("", response_model=list[DeviceOut])
async def list_devices(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    group_id: int | None = Query(None),
    device_type: DeviceType | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    stmt = scope(select(Device), Device, user).order_by(Device.name)
    if group_id is not None:
        stmt = stmt.where(Device.group_id == group_id)
    if device_type is not None:
        stmt = stmt.where(Device.device_type == device_type)
    stmt = stmt.limit(limit).offset(offset)
    return (await session.execute(stmt)).scalars().all()


@router.get("/status")
async def device_statuses(session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    """Último snapshot de status/métricas dos devices da ORG (preenchido pelo poller)."""
    stmt = select(DeviceStatus)
    if not is_master(user):
        stmt = stmt.join(Device, Device.id == DeviceStatus.device_id).where(Device.org_id == user.org_id)
    rows = (await session.execute(stmt)).scalars().all()
    return [
        {
            "device_id": r.device_id,
            "status": r.status,
            "cpu_load": r.cpu_load,
            "ram_used_pct": r.ram_used_pct,
            "temperature": r.temperature,
            "uptime": r.uptime,
            "version": r.version,
            "board": r.board,
            "current_firmware": r.current_firmware,
            "upgrade_firmware": r.upgrade_firmware,
            "error": r.error,
            "checked_at": r.checked_at.isoformat() if r.checked_at else None,
        }
        for r in rows
    ]


@router.get("/{device_id}/samples")
async def device_samples(
    device_id: int,
    hours: int = Query(24, ge=1, le=24 * 90),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Série temporal de métricas (CPU/RAM/temperatura) do device, pelo poller."""
    await _get(session, device_id, user)  # 404 se fora da ORG
    since = datetime.now(UTC) - timedelta(hours=hours)
    rows = (
        await session.execute(
            select(DeviceSample)
            .where(DeviceSample.device_id == device_id, DeviceSample.ts >= since)
            .order_by(DeviceSample.ts)
        )
    ).scalars().all()
    return [
        {"ts": r.ts.isoformat(), "cpu_load": r.cpu_load, "ram_used_pct": r.ram_used_pct, "temperature": r.temperature}
        for r in rows
    ]


@router.post("", response_model=DeviceOut, status_code=201)
async def create_device(payload: DeviceCreate, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    org_id = new_org_id(user)
    if org_id is not None:  # Administrador/Operador: aplica a cota do plano
        from sqlalchemy import func

        count = (await session.execute(select(func.count(Device.id)).where(Device.org_id == org_id))).scalar() or 0
        limit = await _device_limit(session, org_id)
        if count >= limit:
            raise HTTPException(403, f"limite de devices do plano atingido ({count}/{limit})")
    d = Device(org_id=org_id, **payload.model_dump())
    session.add(d)
    await session.commit()
    await session.refresh(d)
    return d


@router.get("/{device_id}", response_model=DeviceOut)
async def get_device(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return await _get(session, device_id, user)


@router.patch("/{device_id}", response_model=DeviceOut)
async def update_device(device_id: int, payload: DeviceUpdate, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    d = await _get(session, device_id, user)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(d, k, v)
    await session.commit()
    await session.refresh(d)
    return d


@router.delete("/{device_id}", status_code=204)
async def delete_device(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    d = await _get(session, device_id, user)
    await session.delete(d)
    await session.commit()


# === Operações read-only (Sprint 2) ===


@router.post("/{device_id}/exec", response_model=ExecResponse)
async def exec_command(
    device_id: int,
    payload: ExecRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    device = await _get(session, device_id, user)
    try:
        output = await runner.exec_command(
            session, actor=f"user:{user.id}", device=device,
            protocol=payload.protocol, command=payload.command,
        )
    except WriteBlocked as e:
        raise HTTPException(403, str(e))
    except CredentialNotFound as e:
        raise HTTPException(400, str(e))
    except TargetBusy as e:
        raise HTTPException(409, str(e))
    except DriverError as e:
        raise HTTPException(502, str(e))
    return ExecResponse(ok=True, output=output)


async def _snmp(device_id, payload, session, user, *, walk: bool) -> SnmpResponse:
    device = await _get(session, device_id, user)
    try:
        records = await runner.exec_snmp(
            session, actor=f"user:{user.id}", device=device, oid=payload.oid, walk=walk
        )
    except CredentialNotFound as e:
        raise HTTPException(400, str(e))
    except TargetBusy as e:
        raise HTTPException(409, str(e))
    except DriverError as e:
        raise HTTPException(502, str(e))
    return SnmpResponse(ok=True, count=len(records), records=records)


@router.post("/{device_id}/snmp/get", response_model=SnmpResponse)
async def snmp_get(device_id: int, payload: SnmpRequest, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return await _snmp(device_id, payload, session, user, walk=False)


@router.post("/{device_id}/snmp/walk", response_model=SnmpResponse)
async def snmp_walk(device_id: int, payload: SnmpRequest, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return await _snmp(device_id, payload, session, user, walk=True)


@router.get("/{device_id}/catalog")
async def list_catalog(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    """Operações de diagnóstico disponíveis para o device (decisão §13)."""
    from app.catalog import for_device_type

    device = await _get(session, device_id, user)
    ops = for_device_type(device.device_type)
    return [
        {"key": o.key, "label": o.label, "protocol": o.protocol.value, "walk": o.walk}
        for o in ops
    ]


@router.post("/{device_id}/catalog/{op_key}")
async def run_catalog(
    device_id: int,
    op_key: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    from app.catalog import get_op
    from app.models.enums import DeviceType  # noqa: F401  (mantém import explícito)

    device = await _get(session, device_id, user)
    op = get_op(op_key)
    if op is None or device.device_type not in op.device_types:
        raise HTTPException(404, "operação de catálogo não disponível para este device")

    try:
        if op.protocol == Protocol.snmp:
            records = await runner.exec_snmp(
                session, actor=f"user:{user.id}", device=device, oid=op.oid, walk=op.walk
            )
            return {"ok": True, "kind": "snmp", "records": records}
        output = await runner.exec_command(
            session, actor=f"user:{user.id}", device=device, protocol=op.protocol, command=op.command
        )
        return {"ok": True, "kind": "exec", "output": output}
    except WriteBlocked as e:
        raise HTTPException(403, str(e))
    except CredentialNotFound as e:
        raise HTTPException(400, str(e))
    except TargetBusy as e:
        raise HTTPException(409, str(e))
    except DriverError as e:
        raise HTTPException(502, str(e))


@router.post("/{device_id}/test", response_model=TestResponse)
async def test_device(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    """Testa quais acessos habilitados têm credencial resolvível (sem conectar)."""
    device = await _get(session, device_id, user)
    results: dict = {}
    checks = [
        (Protocol.ssh, device.ssh_enabled),
        (Protocol.telnet, device.telnet_enabled),
        (Protocol.snmp, device.snmp_enabled),
    ]
    for proto, enabled in checks:
        if not enabled:
            results[proto.value] = {"enabled": False}
            continue
        try:
            cred = await resolve_credential(session, device, proto)
            results[proto.value] = {"enabled": True, "credential": cred.name}
        except CredentialNotFound as e:
            results[proto.value] = {"enabled": True, "error": str(e)}
    ok = all(v.get("error") is None for v in results.values())
    return TestResponse(ok=ok, results=results)
