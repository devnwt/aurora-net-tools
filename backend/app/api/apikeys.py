from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_admin
from app.api.tenancy import new_org_id, owned, scope
from app.core.db import get_session
from app.core.security import generate_api_key, hash_api_key
from app.models import ApiKey, User

router = APIRouter(prefix="/apikeys", tags=["apikeys"], dependencies=[Depends(require_admin)])


class ApiKeyCreate(BaseModel):
    name: str


def _meta(k: ApiKey) -> dict:
    return {
        "id": k.id,
        "name": k.name,
        "prefix": k.prefix,
        "created_at": k.created_at.isoformat() if k.created_at else None,
        "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
    }


@router.get("")
async def list_keys(session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    rows = (await session.execute(scope(select(ApiKey), ApiKey, user).order_by(ApiKey.created_at.desc()))).scalars().all()
    return [_meta(k) for k in rows]


@router.post("", status_code=201)
async def create_key(payload: ApiKeyCreate, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    token = generate_api_key()
    k = ApiKey(org_id=new_org_id(user), name=payload.name, prefix=token[:12], key_hash=hash_api_key(token))
    session.add(k)
    await session.commit()
    await session.refresh(k)
    # o token só é retornado UMA vez (só o hash é guardado)
    return {**_meta(k), "token": token}


@router.delete("/{key_id}", status_code=204)
async def delete_key(key_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    k = (await session.execute(select(ApiKey).where(ApiKey.id == key_id))).scalar_one_or_none()
    owned(k, user)
    await session.delete(k)
    await session.commit()
