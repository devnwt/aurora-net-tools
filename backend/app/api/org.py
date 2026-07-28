"""Autosserviço da PRÓPRIA organização (Admin da empresa).

Danger Zone: exclusão permanente da empresa e de TODOS os seus dados. Restrito
ao Admin da empresa (nunca o Master, que não possui ORG própria) e sempre
limitado à ORG do usuário — jamais cross-tenant. A remoção é definitiva: um
DELETE na `organization` cascateia (ondelete=CASCADE nas FKs) para devices,
sites, racks, credenciais, usuários, backups, chaves de API, webhooks,
templates, auditoria e conversas do Copilot da ORG.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.api.tenancy import plan_status
from app.core.db import get_session
from app.models import Credential, Device, DeviceBackup, DeviceGroup, Organization, Plan, User

log = logging.getLogger("aurora.org")

router = APIRouter(prefix="/org", tags=["org"])


def _ensure_company_admin(user: User) -> None:
    """Exclusivo do Admin da EMPRESA (tem ORG própria). Master não se aplica aqui —
    ele administra ORGs por /admin/orgs."""
    if user.role != "admin" or user.org_id is None:
        raise HTTPException(403, "apenas o administrador da empresa pode acessar esta área")


async def _count(session: AsyncSession, model, org_id: int) -> int:
    return (await session.execute(select(func.count(model.id)).where(model.org_id == org_id))).scalar() or 0


@router.get("")
async def current_org(
    session: AsyncSession = Depends(get_session), user: User = Depends(require_admin)
) -> dict:
    """Resumo da própria empresa: nome, situação do plano e o volume de dados que
    seriam apagados numa exclusão (base da tela de Danger Zone)."""
    _ensure_company_admin(user)
    org = (await session.execute(select(Organization).where(Organization.id == user.org_id))).scalar_one_or_none()
    if org is None:
        raise HTTPException(404, "organização não encontrada")
    plan = None
    if org.plan_id is not None:
        plan = (await session.execute(select(Plan).where(Plan.id == org.plan_id))).scalar_one_or_none()
    # Backups não têm org_id (escopo por device); conta via join (eles cascateiam
    # quando os devices da ORG são removidos).
    backups = (await session.execute(
        select(func.count(DeviceBackup.id)).join(Device, DeviceBackup.device_id == Device.id).where(Device.org_id == org.id)
    )).scalar() or 0
    return {
        "id": org.id,
        "name": org.name,
        "plan_name": plan.name if plan else None,
        "plan_status": plan_status(org),
        "plan_expires_at": org.plan_expires_at.isoformat() if org.plan_expires_at else None,
        "plan_canceled": org.plan_canceled,
        "counts": {
            "devices": await _count(session, Device, org.id),
            "sites": await _count(session, DeviceGroup, org.id),
            "users": await _count(session, User, org.id),
            "credentials": await _count(session, Credential, org.id),
            "backups": backups,
        },
    }


class DeleteOrgIn(BaseModel):
    confirm: str  # nome exato da empresa OU a palavra EXCLUIR


@router.post("/delete", status_code=204)
async def delete_own_org(
    body: DeleteOrgIn, session: AsyncSession = Depends(get_session), user: User = Depends(require_admin)
):
    """Exclui PERMANENTEMENTE a própria empresa e todos os seus dados. Irreversível.
    Exige confirmação explícita (nome da empresa ou EXCLUIR). Só afeta a ORG do
    usuário; não cancela assinatura externa (o sistema não tem billing — o plano é
    um vínculo da própria ORG e é removido junto)."""
    _ensure_company_admin(user)
    org = (await session.execute(select(Organization).where(Organization.id == user.org_id))).scalar_one_or_none()
    if org is None:
        raise HTTPException(404, "organização não encontrada")
    confirm = (body.confirm or "").strip()
    if confirm != org.name and confirm.upper() != "EXCLUIR":
        raise HTTPException(400, "confirmação inválida: digite o nome da empresa ou a palavra EXCLUIR")

    # Auditoria fora do banco: a tabela audit_log pertence à ORG e some na cascata,
    # então o registro definitivo vai para o log da aplicação (Observabilidade, visível
    # ao Master). WARNING para destacar a criticidade.
    log.warning(
        "org.delete: empresa '%s' (id=%s) excluída permanentemente pelo admin '%s' (user_id=%s); plano_id=%s status=%s",
        org.name, org.id, user.username, user.id, org.plan_id, plan_status(org),
    )
    # Uma única transação: DELETE na organization → cascata no banco remove todos
    # os recursos da ORG (FKs com ondelete=CASCADE). Sem órfãos, sem cross-tenant.
    await session.delete(org)
    await session.commit()
