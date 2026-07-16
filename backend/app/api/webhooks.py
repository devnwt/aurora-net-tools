import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_admin
from app.api.tenancy import new_org_id, owned, scope
from app.core.db import get_session
from app.models import User, Webhook
from app.services import webhooks as wh_service

router = APIRouter(prefix="/webhooks", tags=["webhooks"], dependencies=[Depends(require_admin)])


class WebhookIn(BaseModel):
    name: str
    url: str
    events: str = ""
    secret: str = ""
    enabled: bool = True


class WebhookPatch(BaseModel):
    name: str | None = None
    url: str | None = None
    events: str | None = None
    secret: str | None = None
    enabled: bool | None = None


def _meta(w: Webhook) -> dict:
    return {"id": w.id, "name": w.name, "url": w.url, "events": w.events, "enabled": w.enabled, "has_secret": bool(w.secret)}


async def _get(session: AsyncSession, webhook_id: int, user: User) -> Webhook:
    w = (await session.execute(select(Webhook).where(Webhook.id == webhook_id))).scalar_one_or_none()
    return owned(w, user)


@router.get("")
async def list_webhooks(session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    rows = (await session.execute(scope(select(Webhook), Webhook, user).order_by(Webhook.name))).scalars().all()
    return [_meta(w) for w in rows]


@router.post("", status_code=201)
async def create_webhook(payload: WebhookIn, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    w = Webhook(org_id=new_org_id(user), **payload.model_dump())
    session.add(w)
    await session.commit()
    await session.refresh(w)
    return _meta(w)


@router.patch("/{webhook_id}")
async def update_webhook(webhook_id: int, payload: WebhookPatch, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    w = await _get(session, webhook_id, user)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(w, k, v)
    await session.commit()
    await session.refresh(w)
    return _meta(w)


@router.delete("/{webhook_id}", status_code=204)
async def delete_webhook(webhook_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    w = await _get(session, webhook_id, user)
    await session.delete(w)
    await session.commit()


@router.post("/{webhook_id}/test")
async def test_webhook(webhook_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    w = await _get(session, webhook_id, user)
    try:
        status = await wh_service.send_test(w)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"falha ao entregar: {e}")
    return {"ok": 200 <= status < 300, "status": status}
