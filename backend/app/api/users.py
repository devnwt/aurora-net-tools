import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_admin
from app.api.tenancy import is_master, plan_expired, scope
from app.core.db import get_session
from app.core.security import hash_password, password_error
from app.models import Organization, Plan, User, UserGroup
from app.schemas.user import UserCreate, UserOut, UserUpdate
from app.services import notifications

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(require_admin)])

ROLES = ("operator", "admin", "master")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _norm_email(email: str) -> str:
    """Normaliza o e-mail (trim + lower) para uso como login único."""
    return email.strip().lower()


def _check_password(password: str) -> None:
    err = password_error(password)
    if err:
        raise HTTPException(400, err)


async def _check_email(session: AsyncSession, email: str, exclude_id: int | None = None) -> str:
    """Valida formato e unicidade do e-mail (login). Retorna o e-mail normalizado."""
    norm = _norm_email(email)
    if not _EMAIL_RE.match(norm):
        raise HTTPException(400, "e-mail inválido")
    stmt = select(User.id).where(func.lower(User.email) == norm)
    if exclude_id is not None:
        stmt = stmt.where(User.id != exclude_id)
    if (await session.execute(stmt)).first() is not None:
        raise HTTPException(400, "e-mail já cadastrado")
    return norm


async def _get(session: AsyncSession, user_id: int, me: User) -> User:
    u = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if u is None:
        raise HTTPException(404, "usuário não encontrado")
    # não-master só enxerga usuários da própria ORG
    if not is_master(me) and u.org_id != me.org_id:
        raise HTTPException(404, "usuário não encontrado")
    return u


async def _admin_count(session: AsyncSession, org_id: int | None) -> int:
    stmt = select(func.count(User.id)).where(User.role.in_(("admin", "master")))
    if org_id is not None:
        stmt = stmt.where(User.org_id == org_id)
    return (await session.execute(stmt)).scalar() or 0


async def _user_limit(session: AsyncSession, org_id: int) -> int:
    """Cota de usuários da ORG (vem do plano). Sem plano → 0 (bloqueia criação)."""
    org = (await session.execute(select(Organization).where(Organization.id == org_id))).scalar_one_or_none()
    if org is None or plan_expired(org):
        return 0  # sem ORG ou plano vencido → bloqueia criação
    if org.plan_id is not None:
        plan = (await session.execute(select(Plan).where(Plan.id == org.plan_id))).scalar_one_or_none()
        if plan is not None:
            return plan.max_users
    return 0


@router.get("", response_model=list[UserOut])
async def list_users(session: AsyncSession = Depends(get_session), me: User = Depends(get_current_user)):
    return (await session.execute(scope(select(User), User, me).order_by(User.username))).scalars().all()


@router.post("", response_model=UserOut, status_code=201)
async def create_user(payload: UserCreate, session: AsyncSession = Depends(get_session), me: User = Depends(get_current_user)):
    if (await session.execute(select(User).where(User.username == payload.username))).scalar_one_or_none():
        raise HTTPException(400, "nome de usuário já existe")
    _check_password(payload.password)
    email = await _check_email(session, payload.email)

    role = payload.role if payload.role in ROLES else "operator"
    if is_master(me):
        org_id = payload.org_id
    else:
        org_id = me.org_id  # Administrador cria só na própria ORG
        if role == "master":
            raise HTTPException(403, "apenas Master pode criar Master")
        # Aplica a cota de usuários do plano (Master não é limitado).
        if org_id is not None:
            count = (await session.execute(select(func.count(User.id)).where(User.org_id == org_id))).scalar() or 0
            limit = await _user_limit(session, org_id)
            if count >= limit:
                org = (await session.execute(select(Organization).where(Organization.id == org_id))).scalar_one_or_none()
                if plan_expired(org):
                    raise HTTPException(403, "plano da organização expirado — renove para adicionar novos usuários")
                raise HTTPException(403, f"limite de usuários do plano atingido ({count}/{limit})")

    u = User(
        username=payload.username,
        email=email,
        phone=(payload.phone or "").strip() or None,
        password_hash=hash_password(payload.password),
        role=role,
        org_id=org_id,
        is_admin=role in ("admin", "master"),
        is_active=payload.is_active,
    )
    session.add(u)
    await session.flush()  # garante u.id para a notificação de boas-vindas
    await notifications.ensure_welcome(session, u)
    await session.commit()
    await session.refresh(u)
    return u


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(user_id: int, payload: UserUpdate, session: AsyncSession = Depends(get_session), me: User = Depends(get_current_user)):
    u = await _get(session, user_id, me)
    if payload.role and payload.role in ROLES:
        if payload.role == "master" and not is_master(me):
            raise HTTPException(403, "apenas Master pode promover a Master")
        if u.role in ("admin", "master") and payload.role == "operator" and await _admin_count(session, u.org_id) <= 1:
            # Nunca deixar o sistema sem Master; uma ORG pode ficar sem admin se um Master decidir.
            if u.org_id is None or not is_master(me):
                raise HTTPException(400, "não é possível remover o último administrador da organização")
        u.role = payload.role
        u.is_admin = payload.role in ("admin", "master")
    if payload.email is not None:
        u.email = await _check_email(session, payload.email, exclude_id=u.id)
    if payload.password:
        _check_password(payload.password)
        u.password_hash = hash_password(payload.password)
    if payload.is_active is not None and payload.is_active != u.is_active:
        if not payload.is_active:  # desativando
            if u.id == me.id:
                raise HTTPException(400, "não é possível desativar a própria conta")
            # Não deixar uma ORG sem nenhum admin ativo (mesma regra do rebaixamento).
            if u.role in ("admin", "master") and await _admin_count(session, u.org_id) <= 1:
                if u.org_id is None or not is_master(me):
                    raise HTTPException(400, "não é possível desativar o último administrador da organização")
        u.is_active = payload.is_active
    data = payload.model_dump(exclude_unset=True)
    if "phone" in data:
        u.phone = (data["phone"] or "").strip() or None
    if "usergroup_id" in data:
        ug_id = data["usergroup_id"]
        if ug_id is not None:
            g = (await session.execute(select(UserGroup).where(UserGroup.id == ug_id))).scalar_one_or_none()
            if g is None or (not is_master(me) and g.org_id != me.org_id):
                raise HTTPException(400, "grupo de usuário inválido")
        u.usergroup_id = ug_id
    await session.commit()
    await session.refresh(u)
    return u


@router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: int, me: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    u = await _get(session, user_id, me)
    if u.id == me.id:
        raise HTTPException(400, "não é possível excluir a si mesmo")
    if u.role in ("admin", "master") and await _admin_count(session, u.org_id) <= 1:
        # Nunca deixar o sistema sem Master; mas o Master (super admin) pode excluir
        # administradores de uma ORG — inclusive o último dela (a ORG fica sem admin).
        if u.org_id is None or not is_master(me):
            raise HTTPException(400, "não é possível excluir o último administrador")
    await session.delete(u)
    await session.commit()
