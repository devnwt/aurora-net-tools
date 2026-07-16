"""Entrega de webhooks — POST JSON a URLs externas em eventos do sistema.

Best-effort: falhas são logadas, não interrompem o poller. Se o webhook tiver
`secret`, o corpo é assinado (HMAC-SHA256) no header `X-Aurora-Signature`.
"""

import asyncio
import hashlib
import hmac
import json
import logging

import httpx
from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import Webhook

log = logging.getLogger("aurora.webhooks")

TIMEOUT = 8.0


def _headers(wh: Webhook, event: str, body: bytes) -> dict:
    h = {"Content-Type": "application/json", "X-Aurora-Event": event}
    if wh.secret:
        sig = hmac.new(wh.secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
        h["X-Aurora-Signature"] = f"sha256={sig}"
    return h


def _matches(wh: Webhook, event: str) -> bool:
    ev = (wh.events or "").strip()
    if not ev:
        return True  # vazio = todos os eventos
    return event in [e.strip() for e in ev.split(",") if e.strip()]


async def _send(client: httpx.AsyncClient, wh: Webhook, event: str, body: bytes) -> None:
    try:
        r = await client.post(wh.url, content=body, headers=_headers(wh, event, body), timeout=TIMEOUT)
        log.info("webhook '%s' -> %s (%s)", wh.name, r.status_code, wh.url)
    except Exception as e:
        log.warning("webhook '%s' falhou (%s): %s", wh.name, wh.url, e)


async def dispatch(event: str, payload: dict, org_id: int | None = None) -> None:
    """Dispara o evento para os webhooks habilitados que o assinam.

    Webhooks da ORG do recurso (`org_id`) + webhooks globais do Master (org_id NULL).
    """
    async with SessionLocal() as session:
        stmt = select(Webhook).where(Webhook.enabled.is_(True))
        stmt = stmt.where((Webhook.org_id == org_id) | (Webhook.org_id.is_(None)))
        hooks = (await session.execute(stmt)).scalars().all()
    targets = [w for w in hooks if _matches(w, event)]
    if not targets:
        return
    body = json.dumps({"event": event, **payload}, default=str).encode("utf-8")
    async with httpx.AsyncClient() as client:
        await asyncio.gather(*(_send(client, w, event, body) for w in targets))


async def send_test(wh: Webhook) -> int:
    """Envia um payload de teste e devolve o status HTTP (levanta em erro de rede)."""
    body = json.dumps({"event": "test", "message": "Aurora webhook test", "webhook": wh.name}).encode("utf-8")
    async with httpx.AsyncClient() as client:
        r = await client.post(wh.url, content=body, headers=_headers(wh, "test", body), timeout=TIMEOUT)
        return r.status_code
