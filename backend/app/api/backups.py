import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.tenancy import is_master, new_org_id, owned
from app.core.crypto import decrypt
from app.core.db import get_session
from app.drivers.base import DriverError
from app.models import Device, DeviceBackup, User
from app.models.enums import DeviceType, Protocol
from app.services import integrations, runner
from app.services.connlock import TargetBusy
from app.services.credentials import CredentialNotFound

router = APIRouter(prefix="/backups", tags=["backups"], dependencies=[Depends(get_current_user)])


class BackupCreate(BaseModel):
    device_id: int
    send_ftp: bool = False
    send_s3: bool = False


def _protocol(device: Device) -> Protocol:
    if device.ssh_enabled:
        return Protocol.ssh
    if device.telnet_enabled:
        return Protocol.telnet
    raise HTTPException(400, "device sem SSH/Telnet habilitado")


@router.get("")
async def list_backups(session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    stmt = (
        select(DeviceBackup.id, DeviceBackup.device_id, DeviceBackup.created_at, DeviceBackup.size, Device.name)
        .join(Device, Device.id == DeviceBackup.device_id)
        .order_by(DeviceBackup.created_at.desc())
    )
    if not is_master(user):
        stmt = stmt.where(Device.org_id == user.org_id)
    rows = (await session.execute(stmt)).all()
    return [
        {"id": r.id, "device_id": r.device_id, "device_name": r.name, "created_at": r.created_at.isoformat(), "size": r.size}
        for r in rows
    ]


@router.post("", status_code=201)
async def create_backup(payload: BackupCreate, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = (await session.execute(select(Device).where(Device.id == payload.device_id))).scalar_one_or_none()
    owned(device, user)  # 404 se fora da ORG
    if device.device_type != DeviceType.routeros:
        raise HTTPException(400, "backup disponível apenas para RouterOS")
    try:
        content = await runner.exec_command(
            session, actor=f"user:{user.id}", device=device, protocol=_protocol(device), command="/export"
        )
    except CredentialNotFound as e:
        raise HTTPException(400, str(e))
    except TargetBusy as e:
        raise HTTPException(409, str(e))
    except DriverError as e:
        raise HTTPException(502, str(e))

    b = DeviceBackup(device_id=device.id, size=len(content), content=content)
    session.add(b)
    await session.commit()
    await session.refresh(b)

    uploads = await _dispatch(session, user, device, b, content, payload.send_ftp, payload.send_s3)
    return {
        "id": b.id,
        "device_id": device.id,
        "device_name": device.name,
        "created_at": b.created_at.isoformat(),
        "size": b.size,
        "uploads": uploads,
    }


async def _dispatch(session, user, device, backup, content, send_ftp, send_s3) -> dict:
    """Envia o backup para FTP e/ou MinIO/S3 conforme marcado. Nunca falha o backup."""
    uploads: dict = {}
    if not (send_ftp or send_s3):
        return uploads
    org_cfg = await integrations.get_settings(session, new_org_id(user))  # FTP por ORG
    global_cfg = await integrations.get_settings(session, None)           # S3 global (Super Admin)
    ts = backup.created_at.strftime("%Y-%m-%d-%H%M%S")
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", device.name).strip("_") or f"device{device.id}"
    filename = f"{safe}-{ts}.rsc"
    data = content.encode("utf-8")

    if send_ftp:
        if org_cfg and org_cfg.ftp_host:
            ok, detail = await integrations.ftp_upload(org_cfg, decrypt(org_cfg.ftp_password), filename, data)
        else:
            ok, detail = False, "FTP não configurado em Settings"
        uploads["ftp"] = {"ok": ok, "detail": detail}
    if send_s3:
        if global_cfg and global_cfg.s3_endpoint and global_cfg.s3_bucket:
            ok, detail = await integrations.s3_upload(global_cfg, decrypt(global_cfg.s3_secret_key), filename, data)
        else:
            ok, detail = False, "MinIO/S3 não configurado em Super Admin"
        uploads["s3"] = {"ok": ok, "detail": detail}
    return uploads


async def _get(session: AsyncSession, backup_id: int, user: User) -> DeviceBackup:
    b = (await session.execute(select(DeviceBackup).where(DeviceBackup.id == backup_id))).scalar_one_or_none()
    if b is None:
        raise HTTPException(404, "backup não encontrado")
    device = (await session.execute(select(Device).where(Device.id == b.device_id))).scalar_one_or_none()
    owned(device, user)  # 404 se o device não é da ORG
    return b


@router.get("/{backup_id}")
async def get_backup(backup_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    b = await _get(session, backup_id, user)
    return {"id": b.id, "device_id": b.device_id, "created_at": b.created_at.isoformat(), "size": b.size, "content": b.content}


@router.delete("/{backup_id}", status_code=204)
async def delete_backup(backup_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    b = await _get(session, backup_id, user)
    await session.delete(b)
    await session.commit()
