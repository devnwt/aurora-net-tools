"""Observabilidade — leitura dos logs da aplicação (EXCLUSIVO do Admin Master).

A autorização é do backend, não do frontend: `require_master` no `dependencies=`
do router cobre TODAS as rotas abaixo, então bater direto na API com um token de
admin/operator devolve 403 mesmo que a aba esteja escondida na interface.

Toda leitura é de disco e roda em thread separada (`asyncio.to_thread`) — a aba
nunca segura o event loop nem compete com o tráfego normal da aplicação.
"""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import require_master
from app.schemas.observability import EventDetailOut, EventPage, SummaryOut
from app.services import observability

router = APIRouter(
    prefix="/observability",
    tags=["observability"],
    dependencies=[Depends(require_master)],
)


@router.get("/events", response_model=EventPage)
async def list_events(
    level: str | None = Query(None, description="Níveis separados por vírgula (ex.: ERROR,CRITICAL)"),
    service: str | None = Query(None),
    q: str | None = Query(None, description="Busca livre em mensagem, rota, usuário e request id"),
    hours: int = Query(24, ge=1, le=24 * 90, description="Janela de tempo"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    levels = [part.strip() for part in level.split(",") if part.strip()] if level else None
    return await asyncio.to_thread(
        observability.query,
        levels=levels,
        service=service,
        search=q,
        hours=hours,
        limit=limit,
        offset=offset,
    )


@router.get("/summary", response_model=SummaryOut)
async def get_summary(hours: int = Query(24, ge=1, le=24 * 90)):
    return await asyncio.to_thread(observability.summary, hours)


@router.get("/services", response_model=list[str])
async def list_services():
    return await asyncio.to_thread(observability.services)


@router.get("/events/{event_id}", response_model=EventDetailOut)
async def get_event(event_id: str):
    """Detalhe do evento, com stack trace — só aqui o traceback sai da API."""
    event = await asyncio.to_thread(observability.get_event, event_id)
    if event is None:
        raise HTTPException(404, "evento não encontrado")
    return event
