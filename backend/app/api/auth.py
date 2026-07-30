import logging
import re
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, oauth2_scheme
from app.api.tenancy import is_trial_plan, new_plan_expiry, plan_expired, trial_available, trial_deadline
from app.core.config import get_settings
from app.core.cookies import (
    clear_auth_cookies,
    read_access_token,
    read_refresh_token,
    token_response,
)
from app.core.crypto import decrypt
from app.core.db import get_session
from app.core.documents import document_error, normalize_document
from app.core.security import (
    create_scoped_token,
    decode_scoped_token,
    hash_password,
    password_error,
    verify_password,
)
from app.models import Organization, Plan, User
from app.services import emailtpl, emailverify, integrations, loginguard, notifications, sessions

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()
log = logging.getLogger("aurora.auth")

_RESET_PURPOSE = "pwreset"
_RESET_MINUTES = 30


@router.post("/login")
async def login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    session: AsyncSession = Depends(get_session),
) -> dict:
    # Login é APENAS por e-mail (o campo do form chama-se "username" por padrão do
    # OAuth2, mas aqui carrega o e-mail).
    ident = form.username.strip().lower()
    # Proteção anti força-bruta: barra IP acima do limite ou conta em lockout (429).
    await loginguard.before_login(request, ident)
    user = (
        await session.execute(select(User).where(func.lower(User.email) == ident))
    ).scalars().first()
    if user is None or not verify_password(form.password, user.password_hash):
        # Conta a falha (lockout+backoff; levanta 429 se bloquear). Senão, informa
        # quantas tentativas restam no header — para a UI avisar ao chegar perto.
        remaining = await loginguard.on_login_failure(request, ident)
        headers = {"X-Login-Attempts-Left": str(remaining)} if remaining is not None else None
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciais inválidas", headers=headers
        )
    # Senha correta: zera contadores/lockout desta conta.
    await loginguard.on_login_success(ident)
    if not user.is_active:
        # Admin de empresa inativo (ex.: empresa suspensa): em vez de erro seco,
        # oferece "bem-vindo de volta" com escolha de plano p/ reativar a empresa.
        if user.role == "admin" and user.org_id is not None:
            org = (await session.execute(select(Organization).where(Organization.id == user.org_id))).scalar_one_or_none()
            cur_plan = (await session.execute(select(Plan).where(Plan.id == org.plan_id))).scalar_one_or_none() if org and org.plan_id else None
            return {
                "reactivate": True,
                "reactivate_token": create_scoped_token(str(user.id), purpose="reactivate", minutes=15),
                "username": user.username,
                "plans": await _plan_list(session),
                "trial_available": trial_available(org, cur_plan),
            }
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Conta desativada. Fale com o administrador da sua organização.",
        )
    # Nenhum usuário de ORG fica sem plano: sem plano no login → entra no Trial.
    # (Só o Master, que não tem ORG, pode ficar sem plano.)
    if user.org_id is not None:
        org = (await session.execute(select(Organization).where(Organization.id == user.org_id))).scalar_one_or_none()
        if org is not None and org.plan_id is None:
            plans = (await session.execute(select(Plan))).scalars().all()
            trial = next((p for p in plans if is_trial_plan(p)), None)
            if trial is not None:
                org.plan_id = trial.id
                org.plan_expires_at = new_plan_expiry(trial)
                if org.trial_expires_at is None:
                    org.trial_expires_at = trial_deadline()
                await session.commit()
    return token_response(request, await sessions.issue_token_pair(user))


class RefreshIn(BaseModel):
    refresh_token: str | None = None


@router.post("/refresh")
async def refresh_tokens(
    request: Request,
    body: RefreshIn | None = None,
    session: AsyncSession = Depends(get_session),
) -> JSONResponse:
    """Troca refresh por novo par (rotação). Lê body ou cookie HttpOnly."""
    rt = read_refresh_token(request, body.refresh_token if body else None)
    if not rt:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "refresh inválido ou expirado")
    rec = await sessions.revoke_refresh(rt)
    if rec is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "refresh inválido ou expirado")
    await sessions.deny_access(rec.access_jti, rec.access_exp)
    user = (await session.execute(select(User).where(User.id == rec.user_id))).scalar_one_or_none()
    if user is None or not user.is_active or int(user.token_version or 0) != rec.ver:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "sessão revogada")
    return token_response(request, await sessions.issue_token_pair(user))


class LogoutIn(BaseModel):
    refresh_token: str | None = None


@router.post("/logout")
async def logout(
    request: Request,
    body: LogoutIn | None = None,
    token: str | None = Depends(oauth2_scheme),
    user: User = Depends(get_current_user),
) -> JSONResponse:
    """Revoga access/refresh e limpa cookies HttpOnly."""
    del user
    raw = read_access_token(request, token)
    if raw:
        claims = sessions.decode_access_claims(raw)
        if claims:
            await sessions.deny_access(claims.jti, claims.exp)
    rt = read_refresh_token(request, body.refresh_token if body else None)
    if rt:
        await sessions.revoke_refresh(rt)
    resp = JSONResponse({"ok": True})
    clear_auth_cookies(resp)
    return resp


@router.post("/logout-all")
async def logout_all(
    session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
) -> JSONResponse:
    """Invalida TODAS as sessões do usuário (todos os dispositivos)."""
    me = (await session.execute(select(User).where(User.id == user.id))).scalar_one()
    await sessions.bump_token_version(me)
    await session.commit()
    resp = JSONResponse({"ok": True})
    clear_auth_cookies(resp)
    return resp


async def _plan_list(session: AsyncSession) -> list[dict]:
    # Sem o plano de teste: o trial vale só na criação da conta (não reativa no trial).
    rows = (await session.execute(select(Plan).order_by(Plan.max_devices, Plan.name))).scalars().all()
    return [
        {"id": p.id, "name": p.name, "max_devices": p.max_devices, "max_users": p.max_users}
        for p in rows if not is_trial_plan(p)
    ]


class ReactivateIn(BaseModel):
    reactivate_token: str
    plan_id: int


@router.post("/reactivate")
async def reactivate(body: ReactivateIn, request: Request, session: AsyncSession = Depends(get_session)) -> dict:
    """Reativa a empresa de um admin inativo com o plano escolhido e loga o admin.
    O trial ganha 7 dias de vigência; os demais planos ficam sem vencimento."""
    await loginguard.guard_auth_endpoint(request)
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
    # O trial é só da criação: se a ORG já ativou um plano pago, não volta ao trial.
    cur_plan = (await session.execute(select(Plan).where(Plan.id == org.plan_id))).scalar_one_or_none() if org.plan_id else None
    if is_trial_plan(plan) and not trial_available(org, cur_plan):
        raise HTTPException(400, "o plano de teste vale só na criação da conta — escolha um plano pago para reativar")

    org.plan_id = plan.id
    org.plan_canceled = False
    org.plan_expires_at = new_plan_expiry(plan)  # trial: 1 semana; pago: 1 mês
    # Reativa TODA a empresa (o admin voltou e escolheu um plano).
    await session.execute(update(User).where(User.org_id == org.id).values(is_active=True))
    await session.commit()
    return token_response(request, await sessions.issue_token_pair(user))


@router.get("/me")
async def me(
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> dict:
    # Plano da ORG do usuário (menu) + estado de expiração (popup de planos no login).
    # Master não tem ORG: plan_name=None e nada expira.
    plan_name = None
    is_expired = False
    plan_expires_at: str | None = None
    if user.org_id is not None:
        org = (await session.execute(select(Organization).where(Organization.id == user.org_id))).scalar_one_or_none()
        if org is not None:
            is_expired = plan_expired(org)
            plan_expires_at = org.plan_expires_at.isoformat() if org.plan_expires_at else None
            if org.plan_id is not None:
                plan_name = (await session.execute(select(Plan.name).where(Plan.id == org.plan_id))).scalar_one_or_none()
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "name": user.name,
        "phone": user.phone,
        "document": user.document,
        "photo": user.photo,
        "is_admin": user.is_admin,
        "role": user.role,
        "org_id": user.org_id,
        "plan": plan_name,
        "plan_expired": is_expired,
        "plan_expires_at": plan_expires_at,
        # Convidado que ainda não definiu senha (password_hash vazio) → popup infechável.
        "must_set_password": not bool(user.password_hash),
        # Link de suporte (WhatsApp) exposto ao app; vazio = botão oculto.
        "support_whatsapp_url": settings.support_whatsapp_url,
    }


class AcceptInviteIn(BaseModel):
    token: str


@router.post("/accept-invite")
async def accept_invite(
    body: AcceptInviteIn, request: Request, session: AsyncSession = Depends(get_session)
) -> JSONResponse:
    """Entra no sistema a partir do link do convite (usuário sem senha). Devolve o
    token de acesso; o app então exibe o popup infechável para criar a senha."""
    uid = decode_scoped_token(body.token, "invite")
    if uid is None:
        raise HTTPException(400, "convite inválido ou expirado")
    user = (await session.execute(select(User).where(User.id == int(uid)))).scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(400, "convite inválido")
    if user.password_hash:
        raise HTTPException(400, "convite já utilizado — faça login com seu e-mail e senha")
    return token_response(request, await sessions.issue_token_pair(user))


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
    await loginguard.guard_auth_endpoint(request)
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
            html = emailtpl.render(
                heading="Redefinir senha",
                intro="Recebemos um pedido para redefinir a sua senha na Aurora Prisma NetTools. Clique no botão abaixo para escolher uma nova senha.",
                button_label="Redefinir minha senha",
                button_url=link,
                note=f"O link expira em {_RESET_MINUTES} minutos. Se não foi você, ignore este e-mail.",
            )
            await integrations.send_email(cfg, decrypt(cfg.smtp_password), user.email, "Redefinição de senha — Aurora Prisma NetTools", text, html)
    return {"ok": True, "detail": "Se houver uma conta com e-mail cadastrado, enviamos um link de redefinição."}


class ResetIn(BaseModel):
    token: str
    new_password: str


@router.post("/reset-password")
async def reset_password(body: ResetIn, request: Request, session: AsyncSession = Depends(get_session)) -> dict:
    await loginguard.guard_auth_endpoint(request)
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
    await sessions.bump_token_version(user)
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
    name: str  # nome do titular da conta
    password: str
    email: str  # o e-mail é o identificador/login. O plano vem depois.
    document: str  # CPF ou CNPJ do titular (guardado só com dígitos)


async def _create_account(session: AsyncSession, *, org_name: str, name: str | None, email: str, document: str | None, password_hash: str, plan_id: int | None) -> User:
    """Cria a ORG + admin (ativo) e a notificação de boas-vindas, numa transação.
    Sem username próprio: ele espelha o e-mail (login é por e-mail)."""
    plan = None
    if plan_id is not None:
        plan = (await session.execute(select(Plan).where(Plan.id == plan_id))).scalar_one_or_none()
    # trial_expires_at é gravado SEMPRE: fixa a janela de 1 semana em que a conta
    # pode escolher o trial. O vencimento do plano depende do tipo (trial 1 semana,
    # pago 1 mês, sem plano nenhum).
    org = Organization(
        name=org_name,
        plan_id=plan.id if plan else None,
        plan_expires_at=new_plan_expiry(plan),
        trial_expires_at=trial_deadline(),
    )
    session.add(org)
    await session.flush()
    user = User(username=email, email=email, name=name, document=document, password_hash=password_hash, role="admin", is_admin=True, org_id=org.id)
    session.add(user)
    await session.flush()  # garante user.id para a notificação de boas-vindas
    await notifications.ensure_welcome(session, user)
    await session.commit()
    return user


async def _validate_registration(session: AsyncSession, cfg, org_name: str, name: str, email: str, document: str, password: str) -> None:
    """Valida os dados do cadastro (org e e-mail únicos + formato). O plano é
    escolhido só no final, então não é validado aqui."""
    if not (cfg and cfg.registration_enabled):
        raise HTTPException(403, "cadastro público desabilitado")
    if not org_name:
        raise HTTPException(400, "informe a organização")
    if not name:
        raise HTTPException(400, "informe o nome do usuário")
    doc_err = document_error(document)
    if doc_err:
        raise HTTPException(400, doc_err)
    pw_err = password_error(password)
    if pw_err:
        raise HTTPException(400, pw_err)
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(400, "e-mail inválido")
    if (await session.execute(select(Organization).where(Organization.name == org_name))).scalar_one_or_none():
        raise HTTPException(400, "já existe uma organização com esse nome")
    if (await session.execute(select(User.id).where(func.lower(User.email) == email))).first() is not None:
        raise HTTPException(400, "e-mail já cadastrado")


async def _send_verification_email(cfg, email: str, code: str) -> tuple[bool, str]:
    minutes = emailverify.CODE_TTL // 60
    text = (
        "Bem-vindo(a) à Aurora Prisma NetTools!\n\n"
        f"Seu código de confirmação é: {code}\n\n"
        f"Digite-o na tela de cadastro para ativar sua conta. O código expira em {minutes} minutos.\n"
        "Se não foi você, ignore este e-mail."
    )
    html = emailtpl.render(
        heading="Confirme seu e-mail",
        intro="Bem-vindo(a) à Aurora Prisma NetTools! Use o código abaixo para ativar sua conta:",
        code=code,
        note=f"O código expira em {minutes} minutos. Se não foi você, ignore este e-mail.",
    )
    return await integrations.send_email(cfg, decrypt(cfg.smtp_password), email, "Seu código de confirmação — Aurora Prisma NetTools", text, html)


@router.post("/register")
async def register(body: RegisterIn, request: Request, session: AsyncSession = Depends(get_session)) -> dict:
    """Passo 1 do cadastro: valida os dados e envia o código por e-mail (guarda a
    pendência no Redis). A conta NÃO é criada aqui — só após verificar o e-mail e
    escolher o plano. `verification=false` significa "sem código, siga p/ o plano"."""
    await loginguard.guard_auth_endpoint(request)
    cfg = await integrations.get_settings(session, None)
    org_name = body.org_name.strip()
    name = body.name.strip()
    email = body.email.strip().lower()
    document = normalize_document(body.document)
    await _validate_registration(session, cfg, org_name, name, email, document, body.password)

    needs_code = settings.email_verification_enabled and bool(cfg and cfg.smtp_host) and not settings.testing
    code = await emailverify.start(email, {
        "org_name": org_name, "name": name, "email": email, "document": document,
        "password_hash": hash_password(body.password),
    }, needs_code=needs_code)
    if needs_code:
        ok, detail = await _send_verification_email(cfg, email, code)
        if not ok:
            await emailverify.clear(email)
            log.warning("falha ao enviar código de verificação para %s: %s", email, detail)
            raise HTTPException(502, "não foi possível enviar o e-mail de confirmação — tente novamente em instantes")
    return {"verification": needs_code, "email": email, "expires_in": emailverify.CODE_TTL}


class VerifyEmailIn(BaseModel):
    email: str
    code: str


@router.post("/verify-email")
async def verify_email(body: VerifyEmailIn, request: Request, session: AsyncSession = Depends(get_session)) -> dict:
    """Passo 2: confere o código e marca o e-mail como verificado. A conta ainda
    NÃO é criada — o usuário escolhe o plano em seguida."""
    await loginguard.guard_auth_endpoint(request)
    email = body.email.strip().lower()
    status_ = await emailverify.verify(email, body.code)
    if status_ == "expired":
        raise HTTPException(400, "código expirado ou inexistente — refaça o cadastro")
    if status_ == "locked":
        raise HTTPException(429, "muitas tentativas — refaça o cadastro para receber um novo código")
    if status_ == "invalid":
        raise HTTPException(400, "código inválido")
    return {"ok": True, "email": email}


class CompleteRegistrationIn(BaseModel):
    email: str
    plan_id: int | None = None


@router.post("/complete-registration")
async def complete_registration(body: CompleteRegistrationIn, request: Request, session: AsyncSession = Depends(get_session)) -> dict:
    """Passo 3: com o e-mail já verificado, aplica o plano escolhido, cria a conta
    (ativa) e devolve o token (auto-login)."""
    await loginguard.guard_auth_endpoint(request)
    email = body.email.strip().lower()
    data = await emailverify.get(email)
    if data is None or not data.get("verified"):
        raise HTTPException(400, "e-mail não verificado — refaça o cadastro")
    cfg = await integrations.get_settings(session, None)
    plan_id = body.plan_id if body.plan_id is not None else (cfg.registration_plan_id if cfg else None)
    if plan_id is not None and (await session.execute(select(Plan).where(Plan.id == plan_id))).scalar_one_or_none() is None:
        raise HTTPException(400, "plano inválido")
    # Recheca unicidade (corrida entre o início do cadastro e agora).
    if (await session.execute(select(User.id).where(func.lower(User.email) == email))).first() is not None:
        raise HTTPException(400, "e-mail já cadastrado")
    if (await session.execute(select(Organization).where(Organization.name == data["org_name"]))).scalar_one_or_none():
        raise HTTPException(400, "já existe uma organização com esse nome")
    user = await _create_account(
        session, org_name=data["org_name"], name=(data.get("name") or None), email=email,
        document=(data.get("document") or None), password_hash=data["password_hash"], plan_id=plan_id,
    )
    await emailverify.clear(email)
    return token_response(request, await sessions.issue_token_pair(user))


class ResendCodeIn(BaseModel):
    email: str


@router.post("/resend-code")
async def resend_code(body: ResendCodeIn, request: Request, session: AsyncSession = Depends(get_session)) -> dict:
    """Reenvia o código para um cadastro pendente."""
    await loginguard.guard_auth_endpoint(request)
    email = body.email.strip().lower()
    code = await emailverify.resend(email)
    if code is None:
        raise HTTPException(400, "não há cadastro pendente para este e-mail — refaça o cadastro")
    cfg = await integrations.get_settings(session, None)
    if not (cfg and cfg.smtp_host):
        raise HTTPException(400, "envio de e-mail indisponível")
    ok, detail = await _send_verification_email(cfg, email, code)
    if not ok:
        log.warning("falha ao reenviar código para %s: %s", email, detail)
        raise HTTPException(502, "não foi possível reenviar o e-mail — tente novamente em instantes")
    return {"ok": True, "expires_in": emailverify.CODE_TTL}
