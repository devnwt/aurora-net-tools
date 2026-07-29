"""Planos de assinatura — autosserviço do Admin da organização.

Diferente de `/admin/plans` (Master, CRUD de planos do sistema), aqui o admin de
uma ORG só olha os planos disponíveis, simula contra o uso atual e troca o plano
da PRÓPRIA organização. Nunca toca em outra ORG nem edita a definição do plano.

Sem billing: trocar de plano só reescreve `organization.plan_id` e passa a valer
na próxima criação de device/usuário (a checagem de limite já existente).
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.api.tenancy import is_trial_plan, new_plan_expiry, plan_expired, plan_status, trial_available
from app.core.db import get_session
from app.core.documents import format_document
from app.models import Device, Organization, Plan, User
from app.services import billing, notifications

router = APIRouter(prefix="/plans", tags=["plans"], dependencies=[Depends(require_admin)])


class PlanOut(BaseModel):
    id: int
    name: str
    max_devices: int
    max_users: int


class Usage(BaseModel):
    devices: int
    users: int


class CurrentPlan(BaseModel):
    # Master não pertence a uma ORG: has_org=False e o front esconde uso/aplicar.
    has_org: bool
    plan_id: int | None = None
    plan_name: str | None = None
    # Limites EFETIVOS (device pode ter override por-ORG; user vem só do plano).
    max_devices: int
    max_users: int
    device_limit_override: bool  # True = limite de devices vem de override do Master
    usage: Usage
    # Ciclo de vida do plano.
    status: str = "none"  # none | active | canceled | expired
    expires_at: datetime | None = None
    canceled: bool = False
    expired: bool = False
    # Se a ORG ainda pode ESCOLHER o plano de teste (janela fixada na criação da conta).
    trial_available: bool = True


class SelectIn(BaseModel):
    plan_id: int


async def _plan(session: AsyncSession, plan_id: int | None) -> Plan | None:
    if plan_id is None:
        return None
    return (await session.execute(select(Plan).where(Plan.id == plan_id))).scalar_one_or_none()


async def _current(session: AsyncSession, user: User) -> CurrentPlan:
    if user.org_id is None:  # Master (sem ORG própria)
        return CurrentPlan(
            has_org=False, max_devices=0, max_users=0, device_limit_override=False, usage=Usage(devices=0, users=0)
        )
    org = (await session.execute(select(Organization).where(Organization.id == user.org_id))).scalar_one_or_none()
    plan = await _plan(session, org.plan_id if org else None)
    devices = (await session.execute(select(func.count(Device.id)).where(Device.org_id == user.org_id))).scalar() or 0
    users = (await session.execute(select(func.count(User.id)).where(User.org_id == user.org_id))).scalar() or 0

    override = org is not None and org.device_limit is not None
    max_devices = org.device_limit if override else (plan.max_devices if plan else 0)
    max_users = plan.max_users if plan else 0
    return CurrentPlan(
        has_org=True,
        plan_id=plan.id if plan else None,
        plan_name=plan.name if plan else None,
        max_devices=max_devices,
        max_users=max_users,
        device_limit_override=override,
        usage=Usage(devices=devices, users=users),
        status=plan_status(org),
        expires_at=org.plan_expires_at if org else None,
        canceled=bool(org and org.plan_canceled),
        expired=plan_expired(org),
        trial_available=trial_available(org),
    )


@router.get("", response_model=list[PlanOut])
async def list_plans(session: AsyncSession = Depends(get_session)):
    """Planos disponíveis para comparação/simulação."""
    rows = (await session.execute(select(Plan).order_by(Plan.max_devices, Plan.name))).scalars().all()
    return rows


@router.get("/current", response_model=CurrentPlan)
async def current_plan(
    session: AsyncSession = Depends(get_session), user: User = Depends(require_admin)
):
    """Plano atual da ORG do usuário + limites efetivos + uso atual."""
    return await _current(session, user)


@router.post("/select", response_model=CurrentPlan)
async def select_plan(
    payload: SelectIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_admin),
):
    """Aplica um plano à PRÓPRIA organização do admin (grava org.plan_id)."""
    if user.org_id is None:
        raise HTTPException(400, "recurso disponível apenas para administradores de organização")
    plan = await _plan(session, payload.plan_id)
    if plan is None:
        raise HTTPException(404, "plano não encontrado")
    org = (await session.execute(select(Organization).where(Organization.id == user.org_id))).scalar_one_or_none()
    if org is None:
        raise HTTPException(404, "organização não encontrada")
    # Trial só enquanto a janela de elegibilidade (fixada na criação) não venceu.
    if is_trial_plan(plan) and not trial_available(org):
        raise HTTPException(400, "seu período de teste terminou — escolha um plano pago")
    # Só troca o vínculo; devices/usuários existentes não são tocados. Um plano
    # abaixo do uso atual é permitido (fica "acima do limite" e só bloqueia novas
    # criações) — o frontend avisa antes de confirmar.
    changed = org.plan_id != plan.id
    org.plan_id = plan.id
    org.plan_canceled = False  # escolher um plano reativa
    org.plan_expires_at = new_plan_expiry(plan)  # trial: 1 semana; pago: 1 mês
    if changed:
        # Boas-vindas ao novo plano para todos os usuários da empresa (1x por plano).
        await notifications.emit_plan_welcome(session, org, plan)
    await session.commit()
    return await _current(session, user)


class CheckoutOut(BaseModel):
    payment_url: str


@router.post("/checkout", response_model=CheckoutOut)
async def checkout(
    payload: SelectIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_admin),
):
    """Inicia a contratação de um plano PAGO: cria a cobrança no hub com os dados
    do cliente logado e devolve a URL de pagamento (o front redireciona pra lá).

    A ativação do plano só acontece após a confirmação do pagamento — aqui não se
    altera `org.plan_id`."""
    org = await _own_org(session, user)
    plan = await _plan(session, payload.plan_id)
    if plan is None:
        raise HTTPException(404, "plano não encontrado")
    if is_trial_plan(plan):
        raise HTTPException(400, "o plano de teste não requer pagamento")
    if not plan.code:
        raise HTTPException(400, "este plano ainda não está disponível para contratação — contate o suporte")
    # Dados do cliente logado — o documento é obrigatório para a cobrança.
    if not user.document:
        raise HTTPException(400, "informe seu CPF/CNPJ em Meu Perfil antes de contratar um plano")
    if not user.email:
        raise HTTPException(400, "cadastre um e-mail antes de contratar um plano")
    customer = {
        "document": format_document(user.document),
        "name": user.name or org.name,
        "email": user.email,
    }
    try:
        data = await billing.create_charge(
            plan_code=plan.code,
            external_id=str(org.id),  # id do cliente no nosso sistema (a ORG)
            external_reference=f"assinatura-{org.id}-{plan.id}",  # referência livre (org+plano) p/ o webhook
            customer=customer,
        )
    except billing.BillingError as exc:
        raise HTTPException(502, str(exc))
    url = billing.extract_payment_url(data)
    if not url:
        raise HTTPException(502, "não recebemos a URL de pagamento do serviço de cobrança")
    return CheckoutOut(payment_url=url)


async def _own_org(session: AsyncSession, user: User) -> Organization:
    if user.org_id is None:
        raise HTTPException(400, "recurso disponível apenas para administradores de organização")
    org = (await session.execute(select(Organization).where(Organization.id == user.org_id))).scalar_one_or_none()
    if org is None:
        raise HTTPException(404, "organização não encontrada")
    return org


@router.post("/cancel", response_model=CurrentPlan)
async def cancel_plan(session: AsyncSession = Depends(get_session), user: User = Depends(require_admin)):
    """Cancela o plano da própria ORG: mantém acesso até o vencimento e não renova."""
    org = await _own_org(session, user)
    if org.plan_id is None:
        raise HTTPException(400, "não há plano ativo para cancelar")
    org.plan_canceled = True
    await session.commit()
    return await _current(session, user)


@router.post("/reactivate", response_model=CurrentPlan)
async def reactivate_plan(session: AsyncSession = Depends(get_session), user: User = Depends(require_admin)):
    """Desfaz o cancelamento (enquanto o plano ainda não venceu)."""
    org = await _own_org(session, user)
    org.plan_canceled = False
    await session.commit()
    return await _current(session, user)
