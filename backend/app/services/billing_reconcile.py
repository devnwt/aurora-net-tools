"""Reconciliação de pagamentos — a rede de segurança da cobrança.

Consulta no hub (GET /v1/charges/{id}) as cobranças que criamos e ainda não
chegaram a um estado final, e aplica a transição de forma IDEMPOTENTE:
- pending → paid  : ativa o plano na ORG (vencimento de plano pago).
- paid → refunded : revoga o acesso (expira o plano imediatamente).
- expired/canceled: apenas registra (o cliente nunca teve o plano).

Roda em loop no background (main.py) e também sob demanda por ORG (quando o
usuário volta do pagamento), para confirmar rápido sem esperar o ciclo.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.tenancy import new_plan_expiry
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models import Charge, Organization, Plan
from app.services import billing

settings = get_settings()
log = logging.getLogger("aurora.billing")

# Janela em que uma cobrança PAGA ainda é re-consultada (para detectar estorno).
REFUND_WATCH_DAYS = 45
_REFUNDED = {"refunded", "partially_refunded"}


def _parse_dt(value) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


async def _apply(session: AsyncSession, charge: Charge, status: str, paid_at: datetime | None) -> None:
    """Aplica a transição de status na cobrança e no plano da ORG. Idempotente."""
    prev = charge.status
    charge.status = status
    if paid_at and not charge.paid_at:
        charge.paid_at = paid_at

    if status == "paid" and prev != "paid":
        org = await session.get(Organization, charge.org_id) if charge.org_id else None
        plan = await session.get(Plan, charge.plan_id) if charge.plan_id else None
        if org is not None and plan is not None:
            org.plan_id = plan.id
            org.plan_expires_at = new_plan_expiry(plan)  # plano pago: +1 mês
            org.plan_canceled = False
            log.info("cobrança %s PAGA → plano '%s' ativado na ORG %s", charge.hub_charge_id, plan.name, org.id)

    elif status in _REFUNDED and prev not in _REFUNDED:
        org = await session.get(Organization, charge.org_id) if charge.org_id else None
        # Só revoga se a ORG ainda está no plano desta cobrança (não mexe se já trocou).
        if org is not None and charge.plan_id is not None and org.plan_id == charge.plan_id:
            org.plan_expires_at = datetime.now(UTC)  # expira imediatamente
            log.warning("cobrança %s ESTORNADA → acesso revogado na ORG %s", charge.hub_charge_id, org.id)


async def reconcile_once(session: AsyncSession, org_id: int | None = None) -> int:
    """Consulta e reconcilia as cobranças pendentes (+ pagas recentes p/ estorno).
    Se `org_id` for dado, restringe a essa ORG (uso sob demanda). Retorna quantas
    mudaram."""
    cutoff = datetime.now(UTC) - timedelta(days=REFUND_WATCH_DAYS)
    conds = [
        Charge.hub_charge_id != "",
        or_(Charge.status == "pending", and_(Charge.status == "paid", Charge.paid_at >= cutoff)),
    ]
    if org_id is not None:
        conds.append(Charge.org_id == org_id)
    charges = (await session.execute(select(Charge).where(*conds))).scalars().all()

    changed = 0
    for c in charges:
        try:
            data = await billing.get_charge(c.hub_charge_id)
        except billing.ChargeNotFound:
            log.warning("reconciliação: cobrança %s não existe mais no hub", c.hub_charge_id)
            continue
        except billing.BillingError as exc:
            log.warning("reconciliação: falha ao consultar %s: %s", c.hub_charge_id, exc)
            continue
        status = str(data.get("status") or c.status)
        paid_at = _parse_dt(data.get("paid_at"))
        if status != c.status or (paid_at and not c.paid_at):
            await _apply(session, c, status, paid_at)
            changed += 1
    if changed:
        await session.commit()
    return changed


async def reconcile_org(session: AsyncSession, org_id: int) -> int:
    """Reconcilia só as cobranças pendentes de uma ORG (rápido, sob demanda).
    Nunca levanta — falhas de rede são logadas e ignoradas."""
    if not billing.enabled() or org_id is None:
        return 0
    try:
        return await reconcile_once(session, org_id=org_id)
    except Exception as exc:  # não atrapalha o request que chamou
        log.warning("reconcile_org(%s) falhou: %s", org_id, exc)
        return 0


async def run_billing_reconciler() -> None:
    log.info("reconciliador de cobranças iniciado (intervalo=%ss)", settings.billing_reconcile_seconds)
    await asyncio.sleep(12)  # deixa o app subir
    while True:
        try:
            if billing.enabled():
                async with SessionLocal() as session:
                    n = await reconcile_once(session)
                    if n:
                        log.info("reconciliação: %s cobrança(s) atualizada(s)", n)
        except Exception as exc:
            log.warning("ciclo de reconciliação falhou: %s", exc)
        await asyncio.sleep(settings.billing_reconcile_seconds)
