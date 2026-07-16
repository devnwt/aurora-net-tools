from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.tenancy import scope
from app.core.db import get_session
from app.models import AuditLog, User
from app.models.enums import TargetKind
from app.schemas.audit import AuditOut

router = APIRouter(prefix="/audit", tags=["audit"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=list[AuditOut])
async def list_audit(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    actor: str | None = Query(None),
    target_kind: TargetKind | None = Query(None),
    target_id: int | None = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    stmt = scope(select(AuditLog), AuditLog, user).order_by(AuditLog.ts.desc())
    if actor:
        stmt = stmt.where(AuditLog.actor == actor)
    if target_kind:
        stmt = stmt.where(AuditLog.target_kind == target_kind)
    if target_id is not None:
        stmt = stmt.where(AuditLog.target_id == target_id)
    stmt = stmt.limit(limit).offset(offset)
    return (await session.execute(stmt)).scalars().all()
