from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.tenancy import new_org_id, owned, scope
from app.core.db import get_session
from app.models import DeviceGroup, User
from app.schemas.group import GroupCreate, GroupOut, GroupUpdate

router = APIRouter(prefix="/groups", tags=["groups"], dependencies=[Depends(get_current_user)])


async def _get(session: AsyncSession, group_id: int, user: User) -> DeviceGroup:
    g = (await session.execute(select(DeviceGroup).where(DeviceGroup.id == group_id))).scalar_one_or_none()
    return owned(g, user)


@router.get("", response_model=list[GroupOut])
async def list_groups(session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return (await session.execute(scope(select(DeviceGroup), DeviceGroup, user).order_by(DeviceGroup.name))).scalars().all()


@router.post("", response_model=GroupOut, status_code=201)
async def create_group(payload: GroupCreate, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    g = DeviceGroup(org_id=new_org_id(user), **payload.model_dump())
    session.add(g)
    await session.commit()
    await session.refresh(g)
    return g


@router.get("/{group_id}", response_model=GroupOut)
async def get_group(group_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return await _get(session, group_id, user)


@router.patch("/{group_id}", response_model=GroupOut)
async def update_group(group_id: int, payload: GroupUpdate, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    g = await _get(session, group_id, user)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(g, k, v)
    await session.commit()
    await session.refresh(g)
    return g


@router.delete("/{group_id}", status_code=204)
async def delete_group(group_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    g = await _get(session, group_id, user)
    await session.delete(g)
    await session.commit()
