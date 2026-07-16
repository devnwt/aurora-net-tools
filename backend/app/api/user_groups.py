from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_admin
from app.api.tenancy import new_org_id, owned, scope
from app.core.db import get_session
from app.models import User, UserGroup

router = APIRouter(prefix="/user-groups", tags=["user-groups"], dependencies=[Depends(require_admin)])


class UGIn(BaseModel):
    name: str
    parent_id: int | None = None


class UGPatch(BaseModel):
    name: str | None = None
    parent_id: int | None = None


def _ug(g: UserGroup) -> dict:
    return {"id": g.id, "name": g.name, "parent_id": g.parent_id}


async def _get(session: AsyncSession, ug_id: int, user: User) -> UserGroup:
    g = (await session.execute(select(UserGroup).where(UserGroup.id == ug_id))).scalar_one_or_none()
    return owned(g, user)


@router.get("")
async def list_ugroups(session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    rows = (await session.execute(scope(select(UserGroup), UserGroup, user).order_by(UserGroup.name))).scalars().all()
    return [_ug(g) for g in rows]


@router.post("", status_code=201)
async def create_ugroup(payload: UGIn, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    if payload.parent_id is not None:
        await _get(session, payload.parent_id, user)  # o pai precisa ser da ORG
    g = UserGroup(org_id=new_org_id(user), name=payload.name, parent_id=payload.parent_id)
    session.add(g)
    await session.commit()
    await session.refresh(g)
    return _ug(g)


@router.patch("/{ug_id}")
async def update_ugroup(ug_id: int, payload: UGPatch, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    g = await _get(session, ug_id, user)
    data = payload.model_dump(exclude_unset=True)
    if data.get("parent_id") == ug_id:
        raise HTTPException(400, "um grupo não pode ser pai de si mesmo")
    if data.get("parent_id") is not None:
        await _get(session, data["parent_id"], user)
    for k, v in data.items():
        setattr(g, k, v)
    await session.commit()
    await session.refresh(g)
    return _ug(g)


@router.delete("/{ug_id}", status_code=204)
async def delete_ugroup(ug_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    g = await _get(session, ug_id, user)
    await session.delete(g)  # filhos ficam sem pai (SET NULL); membros sem grupo (SET NULL)
    await session.commit()
