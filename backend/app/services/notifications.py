"""Notificações por usuário: boas-vindas + avisos de trial/expiração do plano.

Idempotência: toda criação passa por `_emit`, um INSERT ... ON CONFLICT DO NOTHING
sobre a unicidade (user_id, dedup_key). Assim, rodar o gerador várias vezes (ou o
mesmo evento em ciclos diferentes) nunca duplica.

As notificações de tempo (trial/expiração) derivam do MESMO dado de plano já usado
no resto do sistema — `organization.plan_expires_at` — sem lógica paralela de
assinatura. Um loop de background (`run_notifier`) as gera periodicamente, sem
depender do usuário abrir a aplicação.
"""

import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.api.tenancy import is_trial_plan
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models import Notification, Organization, Plan, User

log = logging.getLogger("aurora.notifier")
settings = get_settings()

_WELCOME_TITLE = "Bem-vindo ao Aurora-Nettools!"
_WELCOME_BODY = (
    "Sua conta foi criada com sucesso. Explore a plataforma e aproveite todos os "
    "recursos disponíveis para sua empresa."
)

# Texto por faixa de proximidade do vencimento. A chave é a "faixa" (bucket); o
# dedup_key inclui a data de vencimento, então uma renovação (nova data) reinicia
# o ciclo sem colidir com o anterior.
_TRIAL_MSG = {
    "7days": "Seu período de Trial termina em 7 dias.",
    "3days": "Seu período de Trial termina em 3 dias.",
    "tomorrow": "Seu período de Trial termina amanhã.",
    "today": "Seu período de Trial termina hoje.",
    "expired": "Seu período de Trial terminou.",
}
_PLAN_MSG = {
    "7days": "Seu plano expira em 7 dias.",
    "3days": "Seu plano expira em 3 dias.",
    "tomorrow": "Seu plano expira amanhã.",
    "today": "Seu plano expira hoje.",
    "expired": "Seu plano expirou.",
}


async def _emit(session, *, user_id: int, org_id: int | None, kind: str, title: str, body: str, dedup_key: str) -> bool:
    """Cria a notificação se ainda não existir (idempotente). Retorna True se inseriu."""
    stmt = (
        pg_insert(Notification)
        .values(user_id=user_id, org_id=org_id, kind=kind, title=title, body=body, dedup_key=dedup_key)
        .on_conflict_do_nothing(index_elements=["user_id", "dedup_key"])
    )
    res = await session.execute(stmt)
    return bool(res.rowcount)


async def ensure_welcome(session, user: User) -> bool:
    """Notificação de boas-vindas, uma única vez por conta (dedup_key='welcome').
    Chamada nos fluxos de criação de usuário; commit fica a cargo do chamador."""
    return await _emit(
        session,
        user_id=user.id,
        org_id=user.org_id,
        kind="welcome",
        title=_WELCOME_TITLE,
        body=_WELCOME_BODY,
        dedup_key="welcome",
    )


async def emit_plan_welcome(session, org, plan) -> int:
    """Boas-vindas ao (novo) plano para todos os usuários da ORG. Uma vez por plano
    (dedup por plano), então trocar de plano gera um novo aviso. Não faz commit."""
    if org is None or plan is None:
        return 0
    title = "Plano atualizado"
    body = f"Bem-vindo(a) ao plano {plan.name}! Aproveite os recursos disponíveis para a sua empresa."
    dedup_key = f"plan-welcome:{plan.id}"
    users = (await session.execute(select(User).where(User.org_id == org.id))).scalars().all()
    created = 0
    for u in users:
        if await _emit(session, user_id=u.id, org_id=org.id, kind="plan_welcome", title=title, body=body, dedup_key=dedup_key):
            created += 1
    return created


def _bucket(expiry: datetime, now: datetime) -> str | None:
    """Faixa de proximidade do vencimento (ou None se ainda faltam >7 dias).

    Faixas por range para ser robusto a ciclos perdidos: cada faixa emite no
    máximo uma vez por período (o dedup_key carrega a data + a faixa)."""
    if expiry <= now:
        return "expired"
    days = (expiry.date() - now.date()).days
    if days <= 0:
        return "today"
    if days == 1:
        return "tomorrow"
    if days <= 3:
        return "3days"
    if days <= 7:
        return "7days"
    return None


async def sync_org(session, org: Organization) -> int:
    """Gera as notificações de trial/expiração devidas para todos os usuários da ORG.
    Retorna quantas foram criadas neste ciclo."""
    if org is None or org.plan_id is None or org.plan_expires_at is None:
        return 0
    now = datetime.now(UTC)
    expiry = org.plan_expires_at
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=UTC)
    bucket = _bucket(expiry, now)
    if bucket is None:
        return 0
    plan = (await session.execute(select(Plan).where(Plan.id == org.plan_id))).scalar_one_or_none()
    trial = is_trial_plan(plan)
    kind = "trial" if trial else "plan"
    msg = (_TRIAL_MSG if trial else _PLAN_MSG)[bucket]
    title = "Período de teste" if trial else "Assinatura"
    dedup_key = f"{kind}:{expiry.date().isoformat()}:{bucket}"

    users = (await session.execute(select(User).where(User.org_id == org.id))).scalars().all()
    created = 0
    for u in users:
        if await _emit(session, user_id=u.id, org_id=org.id, kind=kind, title=title, body=msg, dedup_key=dedup_key):
            created += 1
    if created:
        await session.commit()
    return created


async def sync_all(session) -> int:
    """Percorre todas as ORGs com plano e vencimento definidos."""
    orgs = (
        await session.execute(
            select(Organization).where(Organization.plan_id.is_not(None), Organization.plan_expires_at.is_not(None))
        )
    ).scalars().all()
    total = 0
    for org in orgs:
        try:
            total += await sync_org(session, org)
        except Exception as e:  # um erro numa ORG não derruba o ciclo
            log.warning("sync de notificações falhou na ORG %s: %s", org.id, e)
    return total


async def run_notifier() -> None:
    log.info("notifier iniciado (intervalo=%ss)", settings.notify_interval_seconds)
    await asyncio.sleep(8)  # deixa o app subir antes do 1º ciclo
    while True:
        try:
            async with SessionLocal() as session:
                n = await sync_all(session)
                if n:
                    log.info("notifier: %s notificação(ões) de plano criada(s)", n)
        except Exception as e:
            log.warning("ciclo do notifier falhou: %s", e)
        await asyncio.sleep(settings.notify_interval_seconds)
