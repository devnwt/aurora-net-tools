"""Central de notificações do usuário autenticado.

Isolamento: TODA consulta filtra por `user_id == usuário atual`. Um usuário só
enxerga e só marca como lidas as próprias notificações — nunca as de outro
usuário/empresa (tentar → 404, sem revelar existência).
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_session
from app.models import Notification, User

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _out(n: Notification) -> dict:
    return {
        "id": n.id,
        "kind": n.kind,
        "title": n.title,
        "body": n.body,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "read": n.read_at is not None,
        "read_at": n.read_at.isoformat() if n.read_at else None,
    }


@router.get("")
async def list_notifications(
    session: AsyncSession = Depends(get_session), me: User = Depends(get_current_user)
) -> list[dict]:
    """Notificações do usuário, da mais recente para a mais antiga."""
    rows = (
        await session.execute(
            select(Notification)
            .where(Notification.user_id == me.id)
            .order_by(Notification.created_at.desc(), Notification.id.desc())
        )
    ).scalars().all()
    return [_out(n) for n in rows]


@router.get("/unread-count")
async def unread_count(
    session: AsyncSession = Depends(get_session), me: User = Depends(get_current_user)
) -> dict:
    """Quantidade de notificações não lidas (para o contador do menu)."""
    n = (
        await session.execute(
            select(func.count(Notification.id)).where(
                Notification.user_id == me.id, Notification.read_at.is_(None)
            )
        )
    ).scalar() or 0
    return {"count": n}


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: int, session: AsyncSession = Depends(get_session), me: User = Depends(get_current_user)
) -> dict:
    """Marca UMA notificação como lida (só se pertencer ao usuário)."""
    n = (
        await session.execute(select(Notification).where(Notification.id == notification_id))
    ).scalar_one_or_none()
    if n is None or n.user_id != me.id:
        # Não revela notificações de outros usuários/empresas.
        raise HTTPException(404, "notificação não encontrada")
    if n.read_at is None:
        n.read_at = datetime.now(UTC)
        await session.commit()
    return _out(n)


@router.post("/read-all")
async def mark_all_read(
    session: AsyncSession = Depends(get_session), me: User = Depends(get_current_user)
) -> dict:
    """Marca todas as não lidas do usuário como lidas."""
    res = await session.execute(
        update(Notification)
        .where(Notification.user_id == me.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    await session.commit()
    return {"updated": res.rowcount or 0}
