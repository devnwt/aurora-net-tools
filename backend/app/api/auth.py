import re
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.tenancy import is_trial_plan, new_plan_expiry, trial_available, trial_deadline
from app.core.crypto import decrypt
from app.core.db import get_session
from app.core.security import (
    create_access_token,
    create_scoped_token,
    decode_scoped_token,
    hash_password,
    password_error,
    verify_password,
)
from app.models import Organization, Plan, User
from app.services import integrations, notifications

router = APIRouter(prefix="/auth", tags=["auth"])

_RESET_PURPOSE = "pwreset"
_RESET_MINUTES = 30


@router.post("/login")
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    session: AsyncSession = Depends(get_session),
) -> dict:
    # Login por e-mail (principal) ou username (fallback p/ contas sem e-mail).
    ident = form.username.strip()
    user = (
        await session.execute(
            select(User).where(or_(func.lower(User.email) == ident.lower(), User.username == ident))
        )
    ).scalars().first()
    if user is None or not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciais inválidas"
        )
    if not user.is_active:
        # Admin de empresa inativo (ex.: empresa suspensa): em vez de erro seco,
        # oferece "bem-vindo de volta" com escolha de plano p/ reativar a empresa.
        if user.role == "admin" and user.org_id is not None:
            org = (await session.execute(select(Organization).where(Organization.id == user.org_id))).scalar_one_or_none()
            return {
                "reactivate": True,
                "reactivate_token": create_scoped_token(str(user.id), purpose="reactivate", minutes=15),
                "username": user.username,
                "plans": await _plan_list(session),
                "trial_available": trial_available(org),
            }
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Conta desativada. Fale com o administrador da sua organização.",
        )
    return {"access_token": create_access_token(user.username), "token_type": "bearer"}


async def _plan_list(session: AsyncSession) -> list[dict]:
    rows = (await session.execute(select(Plan).order_by(Plan.max_devices, Plan.name))).scalars().all()
    return [{"id": p.id, "name": p.name, "max_devices": p.max_devices, "max_users": p.max_users} for p in rows]


class ReactivateIn(BaseModel):
    reactivate_token: str
    plan_id: int


@router.post("/reactivate")
async def reactivate(body: ReactivateIn, session: AsyncSession = Depends(get_session)) -> dict:
    """Reativa a empresa de um admin inativo com o plano escolhido e loga o admin.
    O trial ganha 7 dias de vigência; os demais planos ficam sem vencimento."""
    uid = decode_scoped_token(body.reactivate_token, "reactivate")
    if uid is None:
        raise HTTPException(400, "sessão de reativação inválida ou expirada — faça login novamente")
    user = (await session.execute(select(User).where(User.id == int(uid)))).scalar_one_or_none()
    if user is None or user.role != "admin" or user.org_id is None:
        raise HTTPException(400, "conta não elegível para reativação")
    plan = (await session.execute(select(Plan).where(Plan.id == body.plan_id))).scalar_one_or_none()
    if plan is None:
        raise HTTPException(400, "plano inválido")
    org = (await session.execute(select(Organization).where(Organization.id == user.org_id))).scalar_one_or_none()
    if org is None:
        raise HTTPException(404, "organização não encontrada")
    # Trial só se ainda elegível (o prazo é fixado na criação da conta).
    if is_trial_plan(plan) and not trial_available(org):
        raise HTTPException(400, "seu período de teste terminou — escolha um plano pago para reativar")

    org.plan_id = plan.id
    org.plan_canceled = False
    org.plan_expires_at = new_plan_expiry(plan)  # trial: 1 semana; pago: 1 mês
    # Reativa TODA a empresa (o admin voltou e escolheu um plano).
    await session.execute(update(User).where(User.org_id == org.id).values(is_active=True))
    await session.commit()
    return {"access_token": create_access_token(user.username), "token_type": "bearer"}


@router.get("/me")
async def me(
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> dict:
    # Nome do plano da ORG do usuário (para exibir no menu). Master não tem ORG.
    plan_name = None
    if user.org_id is not None:
        plan_name = (
            await session.execute(
                select(Plan.name).join(Organization, Organization.plan_id == Plan.id).where(Organization.id == user.org_id)
            )
        ).scalar_one_or_none()
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "is_admin": user.is_admin,
        "role": user.role,
        "org_id": user.org_id,
        "plan": plan_name,
    }


# === Recuperação de senha (self-service via SMTP global) ===


def _origin(request: Request) -> str:
    # Sempre reduz a esquema+host (referer pode trazer um path, ex.: /login,
    # que quebraria o link de reset).
    raw = request.headers.get("origin") or request.headers.get("referer") or str(request.base_url)
    p = urlsplit(raw)
    if p.scheme and p.netloc:
        return f"{p.scheme}://{p.netloc}"
    return str(request.base_url).rstrip("/")


class ForgotIn(BaseModel):
    identifier: str  # username ou e-mail


@router.post("/forgot-password")
async def forgot_password(body: ForgotIn, request: Request, session: AsyncSession = Depends(get_session)) -> dict:
    ident = body.identifier.strip()
    user = None
    if ident:
        # E-mail case-insensitive (igual ao login); username exato.
        user = (await session.execute(
            select(User).where(or_(User.username == ident, func.lower(User.email) == ident.lower()))
        )).scalars().first()
    # Resposta genérica (não revela se a conta existe).
    if user and user.email:
        cfg = await integrations.get_settings(session, None)  # SMTP global
        if cfg and cfg.smtp_host:
            token = create_scoped_token(str(user.id), _RESET_PURPOSE, _RESET_MINUTES)
            link = f"{_origin(request)}/reset-password?token={token}"
            text = (
                "Recebemos um pedido para redefinir a sua senha na Aurora Prisma NetTools.\n\n"
                f"Abra este link para escolher uma nova senha:\n{link}\n\n"
                f"O link expira em {_RESET_MINUTES} minutos. Se não foi você, ignore este e-mail."
            )
            await integrations.send_email(cfg, decrypt(cfg.smtp_password), user.email, "Redefinição de senha — Aurora Prisma NetTools", text)
    return {"ok": True, "detail": "Se houver uma conta com e-mail cadastrado, enviamos um link de redefinição."}


class ResetIn(BaseModel):
    token: str
    new_password: str


@router.post("/reset-password")
async def reset_password(body: ResetIn, session: AsyncSession = Depends(get_session)) -> dict:
    uid = decode_scoped_token(body.token, _RESET_PURPOSE)
    if not uid:
        raise HTTPException(400, "link inválido ou expirado")
    pw_err = password_error(body.new_password)
    if pw_err:
        raise HTTPException(400, pw_err)
    user = (await session.execute(select(User).where(User.id == int(uid)))).scalar_one_or_none()
    if user is None:
        raise HTTPException(400, "usuário não encontrado")
    user.password_hash = hash_password(body.new_password)
    await session.commit()
    return {"ok": True, "detail": "Senha redefinida. Você já pode entrar."}


# === Cadastro público (self-signup de tenant), se habilitado no Super Admin ===


@router.get("/registration-status")
async def registration_status(session: AsyncSession = Depends(get_session)) -> dict:
    cfg = await integrations.get_settings(session, None)
    return {"enabled": bool(cfg and cfg.registration_enabled)}


@router.get("/plans")
async def public_plans(session: AsyncSession = Depends(get_session)) -> dict:
    """Catálogo público de planos para a tela de boas-vindas do cadastro.
    Só exposto quando o cadastro público está habilitado."""
    cfg = await integrations.get_settings(session, None)
    if not (cfg and cfg.registration_enabled):
        return {"plans": [], "default_plan_id": None}
    rows = (await session.execute(select(Plan).order_by(Plan.max_devices, Plan.name))).scalars().all()
    return {
        "plans": [{"id": p.id, "name": p.name, "max_devices": p.max_devices, "max_users": p.max_users} for p in rows],
        "default_plan_id": cfg.registration_plan_id,
    }


class RegisterIn(BaseModel):
    org_name: str
    username: str
    password: str
    email: str  # obrigatório: será o login (e-mail + senha)
    plan_id: int | None = None  # plano escolhido no cadastro (default: trial)


@router.post("/register")
async def register(body: RegisterIn, session: AsyncSession = Depends(get_session)) -> dict:
    cfg = await integrations.get_settings(session, None)
    if not (cfg and cfg.registration_enabled):
        raise HTTPException(403, "cadastro público desabilitado")
    org_name, username = body.org_name.strip(), body.username.strip()
    email = body.email.strip().lower()
    if not org_name or not username:
        raise HTTPException(400, "informe organização e usuário")
    pw_err = password_error(body.password)
    if pw_err:
        raise HTTPException(400, pw_err)
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(400, "e-mail inválido")
    if (await session.execute(select(Organization).where(Organization.name == org_name))).scalar_one_or_none():
        raise HTTPException(400, "já existe uma organização com esse nome")
    if (await session.execute(select(User).where(User.username == username))).scalar_one_or_none():
        raise HTTPException(400, "nome de usuário já existe")
    if (await session.execute(select(User.id).where(func.lower(User.email) == email))).first() is not None:
        raise HTTPException(400, "e-mail já cadastrado")

    # Plano escolhido no cadastro (fallback: o default do Master). O plano de teste
    # ganha vencimento automático de 1 semana a partir de agora.
    plan_id = body.plan_id if body.plan_id is not None else cfg.registration_plan_id
    plan = None
    if plan_id is not None:
        plan = (await session.execute(select(Plan).where(Plan.id == plan_id))).scalar_one_or_none()
        if plan is None:
            raise HTTPException(400, "plano inválido")
    # trial_expires_at é gravado SEMPRE (independe do plano): fixa a janela de 1
    # semana em que esta conta ainda pode escolher o trial. O vencimento do plano
    # depende do tipo: trial 1 semana, pago 1 mês, sem plano nenhum vencimento.
    org = Organization(
        name=org_name,
        plan_id=plan.id if plan else None,
        plan_expires_at=new_plan_expiry(plan),
        trial_expires_at=trial_deadline(),
    )
    session.add(org)
    await session.flush()
    user = User(
        username=username,
        email=email,
        password_hash=hash_password(body.password),
        role="admin",
        is_admin=True,
        org_id=org.id,
    )
    session.add(user)
    await session.flush()  # garante user.id para a notificação de boas-vindas
    await notifications.ensure_welcome(session, user)
    await session.commit()
    return {"access_token": create_access_token(user.username), "token_type": "bearer"}
