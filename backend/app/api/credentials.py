from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.tenancy import new_org_id, owned, scope
from app.core.crypto import encrypt
from app.core.db import get_session
from app.models import Credential, User
from app.schemas.credential import CredentialCreate, CredentialOut, CredentialUpdate

router = APIRouter(prefix="/credentials", tags=["credentials"], dependencies=[Depends(get_current_user)])


async def _get(session: AsyncSession, cred_id: int, user: User) -> Credential:
    cred = (await session.execute(select(Credential).where(Credential.id == cred_id))).scalar_one_or_none()
    return owned(cred, user)


@router.get("", response_model=list[CredentialOut])
async def list_credentials(session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    rows = (await session.execute(scope(select(Credential), Credential, user).order_by(Credential.name))).scalars().all()
    return [CredentialOut.from_model(c) for c in rows]


@router.post("", response_model=CredentialOut, status_code=201)
async def create_credential(payload: CredentialCreate, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    cred = Credential(
        org_id=new_org_id(user),
        name=payload.name,
        kind=payload.kind,
        username=payload.username,
        secret=encrypt(payload.secret) if payload.secret else "",
        snmp_version=payload.snmp_version,
        snmp_v3_auth_protocol=payload.snmp_v3_auth_protocol,
        snmp_v3_priv_protocol=payload.snmp_v3_priv_protocol,
        snmp_v3_priv_secret=encrypt(payload.snmp_v3_priv_secret) if payload.snmp_v3_priv_secret else None,
    )
    session.add(cred)
    await session.commit()
    await session.refresh(cred)
    return CredentialOut.from_model(cred)


@router.get("/{cred_id}", response_model=CredentialOut)
async def get_credential(cred_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return CredentialOut.from_model(await _get(session, cred_id, user))


@router.patch("/{cred_id}", response_model=CredentialOut)
async def update_credential(cred_id: int, payload: CredentialUpdate, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    cred = await _get(session, cred_id, user)
    data = payload.model_dump(exclude_unset=True)
    if "secret" in data:
        cred.secret = encrypt(data.pop("secret")) if data["secret"] else ""
    if "snmp_v3_priv_secret" in data:
        val = data.pop("snmp_v3_priv_secret")
        cred.snmp_v3_priv_secret = encrypt(val) if val else None
    for k, v in data.items():
        setattr(cred, k, v)
    await session.commit()
    await session.refresh(cred)
    return CredentialOut.from_model(cred)


@router.delete("/{cred_id}", status_code=204)
async def delete_credential(cred_id: int, session: AsyncSession = Depends(get_session)):
    cred = await _get(session, cred_id)
    await session.delete(cred)
    await session.commit()
