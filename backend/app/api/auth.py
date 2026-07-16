from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.crypto import decrypt
from app.core.db import get_session
from app.core.security import (
    create_access_token,
    create_scoped_token,
    decode_scoped_token,
    hash_password,
    verify_password,
)
from app.models import Organization, User
from app.services import integrations

router = APIRouter(prefix="/auth", tags=["auth"])

_RESET_PURPOSE = "pwreset"
_RESET_MINUTES = 30


@router.post("/login")
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    session: AsyncSession = Depends(get_session),
) -> dict:
    user = (
        await session.execute(select(User).where(User.username == form.username))
    ).scalar_one_or_none()
    if user is None or not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciais inválidas"
        )
    return {"access_token": create_access_token(user.username), "token_type": "bearer"}


@router.get("/me")
async def me(user: User = Depends(get_current_user)) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "is_admin": user.is_admin,
        "role": user.role,
        "org_id": user.org_id,
    }


# === Recuperação de senha (self-service via SMTP global) ===


def _origin(request: Request) -> str:
    o = request.headers.get("origin") or request.headers.get("referer")
    if o:
        return o.rstrip("/")
    return str(request.base_url).rstrip("/")


class ForgotIn(BaseModel):
    identifier: str  # username ou e-mail


@router.post("/forgot-password")
async def forgot_password(body: ForgotIn, request: Request, session: AsyncSession = Depends(get_session)) -> dict:
    ident = body.identifier.strip()
    user = None
    if ident:
        user = (await session.execute(
            select(User).where(or_(User.username == ident, User.email == ident))
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
    if len(body.new_password) < 6:
        raise HTTPException(400, "a senha deve ter ao menos 6 caracteres")
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


class RegisterIn(BaseModel):
    org_name: str
    username: str
    password: str
    email: str | None = None


@router.post("/register")
async def register(body: RegisterIn, session: AsyncSession = Depends(get_session)) -> dict:
    cfg = await integrations.get_settings(session, None)
    if not (cfg and cfg.registration_enabled):
        raise HTTPException(403, "cadastro público desabilitado")
    org_name, username = body.org_name.strip(), body.username.strip()
    if not org_name or not username or len(body.password) < 6:
        raise HTTPException(400, "informe organização, usuário e senha (≥6 caracteres)")
    if (await session.execute(select(Organization).where(Organization.name == org_name))).scalar_one_or_none():
        raise HTTPException(400, "já existe uma organização com esse nome")
    if (await session.execute(select(User).where(User.username == username))).scalar_one_or_none():
        raise HTTPException(400, "nome de usuário já existe")

    org = Organization(name=org_name, plan_id=cfg.registration_plan_id)
    session.add(org)
    await session.flush()
    user = User(
        username=username,
        email=(body.email or None),
        password_hash=hash_password(body.password),
        role="admin",
        is_admin=True,
        org_id=org.id,
    )
    session.add(user)
    await session.commit()
    return {"access_token": create_access_token(user.username), "token_type": "bearer"}
