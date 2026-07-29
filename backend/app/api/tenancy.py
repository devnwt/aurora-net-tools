"""Helpers de isolamento por ORG (multi-tenant).

Master enxerga tudo (inclusive recursos sem ORG). Admin/Operator só a própria ORG.
Recursos criados por não-master herdam o `org_id` do usuário.
"""

import calendar
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Organization, User

# Nome de plano de teste (mesma regra do frontend em lib/plans.ts). O trial dá 1
# semana de vigência e, uma vez esgotada a elegibilidade, não pode ser reescolhido.
TRIAL_RE = re.compile(r"trial|gr[aá]ti|free", re.IGNORECASE)
TRIAL_DAYS = 7


def is_master(user: User) -> bool:
    return user.role == "master"


def is_trial_plan(plan) -> bool:
    """True se o plano é o de teste (detecção por nome)."""
    return plan is not None and bool(TRIAL_RE.search(plan.name))


def trial_deadline() -> datetime:
    """Prazo de elegibilidade ao teste: exatamente uma semana a partir de agora."""
    return datetime.now(UTC) + timedelta(days=TRIAL_DAYS)


def _add_month(dt: datetime) -> datetime:
    """Mesmo dia no mês seguinte, ajustando meses mais curtos (31/jan → 28-29/fev)."""
    year, month = (dt.year + 1, 1) if dt.month == 12 else (dt.year, dt.month + 1)
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def plan_deadline() -> datetime:
    """Vencimento padrão ao ASSINAR um plano pago: 1 mês a partir de agora."""
    return _add_month(datetime.now(UTC))


def new_plan_expiry(plan) -> datetime | None:
    """Vencimento a gravar ao passar a ORG para `plan`: trial → 1 semana; plano
    pago → 1 mês; sem plano → sem vencimento."""
    if plan is None:
        return None
    return trial_deadline() if is_trial_plan(plan) else plan_deadline()


def trial_available(org: Organization | None, current_plan=None) -> bool:
    """True se a ORG ainda pode estar no plano de TESTE. O trial é concedido uma
    ÚNICA vez, na CRIAÇÃO da conta; depois que um plano PAGO é ativado, não há como
    voltar ao trial. Disponível só enquanto a ORG está sem plano ou ainda no trial."""
    if org is None:
        return True
    return current_plan is None or is_trial_plan(current_plan)


def plan_expired(org: Organization | None) -> bool:
    """True se a ORG tem plano com vencimento no passado. Sem plano ou sem data
    de vencimento → não expirado. Base da regra: plano vencido bloqueia novas
    criações (mesma cota de 'sem plano')."""
    if org is None or org.plan_id is None or org.plan_expires_at is None:
        return False
    return org.plan_expires_at <= datetime.now(UTC)


def plan_status(org: Organization | None) -> str:
    """Estado do plano para exibição: none | active | canceled | expired."""
    if org is None or org.plan_id is None:
        return "none"
    if plan_expired(org):
        return "expired"
    return "canceled" if org.plan_canceled else "active"


def scope(stmt, model, user: User):
    """Adiciona filtro `org_id == user.org_id` quando o usuário não é master."""
    if is_master(user):
        return stmt
    return stmt.where(model.org_id == user.org_id)


def owned(obj, user: User):
    """404 se o recurso não pertence à ORG do usuário (e ele não é master)."""
    if obj is None:
        raise HTTPException(404, "não encontrado")
    if not is_master(user) and getattr(obj, "org_id", None) != user.org_id:
        raise HTTPException(404, "não encontrado")
    return obj


def new_org_id(user: User) -> int | None:
    """ORG a atribuir em recursos recém-criados (None para master = recurso de sistema)."""
    return None if is_master(user) else user.org_id


@dataclass(frozen=True)
class OrgFk:
    """FK a validar contra a ORG do recurso pai (device, grupo, controller, rack…)."""

    model: type
    fk_id: int | None


async def require_org_fk(session: AsyncSession, org_id: int | None, fk: OrgFk) -> None:
    """Garante que o FK aponta para um registro da mesma ORG (ou ambos sistema).

    `fk_id is None` limpa o vínculo (sempre permitido). ID inexistente ou de outra
    ORG → 404 genérico (não enumera recursos cross-tenant).
    """
    if fk.fk_id is None:
        return
    obj = (await session.execute(select(fk.model).where(fk.model.id == fk.fk_id))).scalar_one_or_none()
    if obj is None or getattr(obj, "org_id", None) != org_id:
        raise HTTPException(404, "não encontrado")


async def require_org_fks(session: AsyncSession, org_id: int | None, fks: list[OrgFk]) -> None:
    """Valida uma lista de FKs contra a mesma ORG."""
    for fk in fks:
        await require_org_fk(session, org_id, fk)
