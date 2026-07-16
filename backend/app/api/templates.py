from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.tenancy import new_org_id, owned, scope
from app.core.db import get_session
from app.models import CommandTemplate, User
from app.schemas.template import TemplateCreate, TemplateOut, TemplateUpdate

router = APIRouter(prefix="/templates", tags=["templates"], dependencies=[Depends(get_current_user)])


async def _get(session: AsyncSession, template_id: int, user: User) -> CommandTemplate:
    t = (await session.execute(select(CommandTemplate).where(CommandTemplate.id == template_id))).scalar_one_or_none()
    return owned(t, user)


@router.get("", response_model=list[TemplateOut])
async def list_templates(session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return (await session.execute(scope(select(CommandTemplate), CommandTemplate, user).order_by(CommandTemplate.name))).scalars().all()


@router.post("", response_model=TemplateOut, status_code=201)
async def create_template(payload: TemplateCreate, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    t = CommandTemplate(org_id=new_org_id(user), **payload.model_dump())
    session.add(t)
    await session.commit()
    await session.refresh(t)
    return t


@router.patch("/{template_id}", response_model=TemplateOut)
async def update_template(template_id: int, payload: TemplateUpdate, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    t = await _get(session, template_id, user)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    await session.commit()
    await session.refresh(t)
    return t


@router.delete("/{template_id}", status_code=204)
async def delete_template(template_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    t = await _get(session, template_id, user)
    await session.delete(t)
    await session.commit()
