import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_admin
from app.api.tenancy import new_org_id
from app.core.config import get_settings
from app.core.crypto import decrypt, encrypt
from app.core.db import get_session
from app.models import Device, DeviceSample, DeviceStatus, OrgSettings, User
from app.services import integrations
from app.services.poller import poll_once

router = APIRouter(prefix="/settings", tags=["settings"], dependencies=[Depends(get_current_user)])
_settings = get_settings()


@router.get("/info")
async def info(session: AsyncSession = Depends(get_session)):
    devices = (await session.execute(select(func.count(Device.id)))).scalar()
    statuses = (await session.execute(select(func.count(DeviceStatus.id)))).scalar()
    samples = (await session.execute(select(func.count(DeviceSample.id)))).scalar()
    return {
        "app": _settings.app_name,
        "poll_enabled": _settings.poll_enabled,
        "poll_interval_seconds": _settings.poll_interval_seconds,
        "poll_concurrency": _settings.poll_concurrency,
        "sample_retention_days": _settings.sample_retention_days,
        "counts": {"devices": devices, "statuses": statuses, "samples": samples},
    }


@router.post("/poll", status_code=202)
async def poll_now():
    """Dispara um ciclo de poll imediato (em background)."""
    asyncio.create_task(poll_once())
    return {"ok": True}


# === Integrações por ORG: SMTP / FTP / LLM ================================
# Uma linha por ORG (org_id do usuário; master = NULL/global). Segredos são
# cifrados (Fernet); nunca retornados — apenas o flag *_set.


async def _integrations_row(session: AsyncSession, user: User) -> OrgSettings:
    org_id = new_org_id(user)
    row = (await session.execute(select(OrgSettings).where(OrgSettings.org_id == org_id))).scalar_one_or_none()
    if row is None:
        row = OrgSettings(org_id=org_id)
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return row


def _integrations_out(row: OrgSettings) -> dict:
    return {
        # SMTP, LLM, MinIO/S3 e Copilot Tools saíram daqui: agora são globais (Super Admin → /admin).
        "ftp": {
            "enabled": row.ftp_enabled,
            "host": row.ftp_host,
            "port": row.ftp_port,
            "username": row.ftp_username,
            "path": row.ftp_path,
            "use_tls": row.ftp_use_tls,
            "password_set": bool(row.ftp_password),
        },
    }


class FtpIn(BaseModel):
    enabled: bool | None = None
    host: str | None = None
    port: int | None = None
    username: str | None = None
    password: str | None = None
    path: str | None = None
    use_tls: bool | None = None


class IntegrationsIn(BaseModel):
    ftp: FtpIn | None = None


@router.get("/integrations")
async def get_integrations(session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return _integrations_out(await _integrations_row(session, user))


def _apply(row: OrgSettings, data: dict, mapping: dict[str, str], secret_fields: dict[str, str]) -> None:
    """Aplica campos presentes (exclude_unset). Segredos cifram; "" limpa."""
    for src, dst in mapping.items():
        if src in data:
            setattr(row, dst, data[src])
    for src, dst in secret_fields.items():
        if src in data:
            val = data[src]
            setattr(row, dst, encrypt(val) if val else "")


@router.put("/integrations")
async def put_integrations(
    payload: IntegrationsIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_admin),
):
    row = await _integrations_row(session, user)
    if payload.ftp is not None:
        d = payload.ftp.model_dump(exclude_unset=True)
        _apply(row, d, {"enabled": "ftp_enabled", "host": "ftp_host", "port": "ftp_port", "username": "ftp_username", "path": "ftp_path", "use_tls": "ftp_use_tls"}, {"password": "ftp_password"})
    await session.commit()
    await session.refresh(row)
    return _integrations_out(row)


@router.post("/integrations/ftp/test")
async def test_ftp(session: AsyncSession = Depends(get_session), user: User = Depends(require_admin)):
    row = await _integrations_row(session, user)
    if not row.ftp_host:
        raise HTTPException(400, "configure e salve o FTP antes de testar")
    ok, detail = await integrations.ftp_test(row, decrypt(row.ftp_password))
    return {"ok": ok, "detail": detail}
