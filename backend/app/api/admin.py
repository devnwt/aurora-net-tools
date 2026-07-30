"""Administração do sistema (Master): planos e organizações (ORGs)."""

import re
import secrets
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_master
from app.api.tenancy import plan_status
from app.core.crypto import decrypt, encrypt
from app.core.db import get_session
from app.core.security import hash_password, password_error
from app.models import Device, Organization, Plan, User
from app.services import emailtpl, integrations, notifications, sessions

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_master)])


# === SMTP global (config do sistema, org_id NULL) — base dos e-mails de acesso ===


async def _global_settings(session: AsyncSession):
    return await integrations.get_or_create_settings(session, None)


def _smtp_out(r) -> dict:
    return {
        "enabled": r.smtp_enabled, "host": r.smtp_host, "port": r.smtp_port, "username": r.smtp_username,
        "from_addr": r.smtp_from, "use_tls": r.smtp_use_tls, "password_set": bool(r.smtp_password),
    }


class SmtpIn(BaseModel):
    enabled: bool | None = None
    host: str | None = None
    port: int | None = None
    username: str | None = None
    password: str | None = None  # ausente = mantém; "" = limpa
    from_addr: str | None = None
    use_tls: bool | None = None


@router.get("/smtp")
async def get_smtp(session: AsyncSession = Depends(get_session)):
    return _smtp_out(await _global_settings(session))


@router.put("/smtp")
async def put_smtp(payload: SmtpIn, session: AsyncSession = Depends(get_session)):
    r = await _global_settings(session)
    d = payload.model_dump(exclude_unset=True)
    for src, dst in {"enabled": "smtp_enabled", "host": "smtp_host", "port": "smtp_port", "username": "smtp_username", "from_addr": "smtp_from", "use_tls": "smtp_use_tls"}.items():
        if src in d:
            setattr(r, dst, d[src])
    if "password" in d:
        r.smtp_password = encrypt(d["password"]) if d["password"] else ""
    await session.commit()
    await session.refresh(r)
    return _smtp_out(r)


class SmtpTestIn(BaseModel):
    to: str


@router.post("/smtp/test")
async def test_smtp(body: SmtpTestIn, session: AsyncSession = Depends(get_session)):
    r = await _global_settings(session)
    if not r.smtp_host:
        raise HTTPException(400, "configure e salve o SMTP global antes de testar")
    ok, detail = await integrations.smtp_test(r, decrypt(r.smtp_password), body.to)
    return {"ok": ok, "detail": detail}


# === LLM global (OpenAI-compatible) — usado pelo Copilot de todas as ORGs ===


def _llm_out(r) -> dict:
    return {"enabled": r.llm_enabled, "base_url": r.llm_base_url, "model": r.llm_model, "api_key_set": bool(r.llm_api_key)}


class LlmIn(BaseModel):
    enabled: bool | None = None
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None  # ausente = mantém; "" = limpa


@router.get("/llm")
async def get_llm(session: AsyncSession = Depends(get_session)):
    return _llm_out(await _global_settings(session))


@router.put("/llm")
async def put_llm(payload: LlmIn, session: AsyncSession = Depends(get_session)):
    r = await _global_settings(session)
    d = payload.model_dump(exclude_unset=True)
    for src, dst in {"enabled": "llm_enabled", "base_url": "llm_base_url", "model": "llm_model"}.items():
        if src in d:
            setattr(r, dst, d[src])
    if "api_key" in d:
        r.llm_api_key = encrypt(d["api_key"]) if d["api_key"] else ""
    await session.commit()
    await session.refresh(r)
    return _llm_out(r)


@router.post("/llm/test")
async def test_llm(session: AsyncSession = Depends(get_session)):
    r = await _global_settings(session)
    if not r.llm_base_url:
        raise HTTPException(400, "configure e salve o LLM global antes de testar")
    ok, detail = await integrations.llm_test(r, decrypt(r.llm_api_key))
    return {"ok": ok, "detail": detail}


# === MinIO/S3 global — destino de backups de todas as ORGs ===


def _s3_out(r) -> dict:
    return {
        "enabled": r.s3_enabled, "endpoint": r.s3_endpoint, "region": r.s3_region, "bucket": r.s3_bucket,
        "access_key": r.s3_access_key, "prefix": r.s3_prefix, "use_ssl": r.s3_use_ssl, "secret_key_set": bool(r.s3_secret_key),
    }


class S3In(BaseModel):
    enabled: bool | None = None
    endpoint: str | None = None
    region: str | None = None
    bucket: str | None = None
    access_key: str | None = None
    secret_key: str | None = None  # ausente = mantém; "" = limpa
    prefix: str | None = None
    use_ssl: bool | None = None


@router.get("/s3")
async def get_s3(session: AsyncSession = Depends(get_session)):
    return _s3_out(await _global_settings(session))


@router.put("/s3")
async def put_s3(payload: S3In, session: AsyncSession = Depends(get_session)):
    r = await _global_settings(session)
    d = payload.model_dump(exclude_unset=True)
    for src, dst in {"enabled": "s3_enabled", "endpoint": "s3_endpoint", "region": "s3_region", "bucket": "s3_bucket", "access_key": "s3_access_key", "prefix": "s3_prefix", "use_ssl": "s3_use_ssl"}.items():
        if src in d:
            setattr(r, dst, d[src])
    if "secret_key" in d:
        r.s3_secret_key = encrypt(d["secret_key"]) if d["secret_key"] else ""
    await session.commit()
    await session.refresh(r)
    return _s3_out(r)


@router.post("/s3/test")
async def test_s3(session: AsyncSession = Depends(get_session)):
    r = await _global_settings(session)
    if not r.s3_endpoint or not r.s3_bucket:
        raise HTTPException(400, "configure e salve o MinIO/S3 (endpoint + bucket) antes de testar")
    ok, detail = await integrations.s3_test(r, decrypt(r.s3_secret_key))
    return {"ok": ok, "detail": detail}


# === Cadastro público (self-signup de tenant) ===


class RegistrationIn(BaseModel):
    enabled: bool | None = None
    plan_id: int | None = None


@router.get("/registration")
async def get_registration(session: AsyncSession = Depends(get_session)):
    r = await _global_settings(session)
    return {"enabled": r.registration_enabled, "plan_id": r.registration_plan_id}


@router.put("/registration")
async def put_registration(payload: RegistrationIn, session: AsyncSession = Depends(get_session)):
    r = await _global_settings(session)
    d = payload.model_dump(exclude_unset=True)
    if "enabled" in d:
        r.registration_enabled = d["enabled"]
    if "plan_id" in d:
        pid = d["plan_id"]
        if pid is not None and (await session.execute(select(Plan).where(Plan.id == pid))).scalar_one_or_none() is None:
            raise HTTPException(400, "plano inválido")
        r.registration_plan_id = pid
    await session.commit()
    await session.refresh(r)
    return {"enabled": r.registration_enabled, "plan_id": r.registration_plan_id}


# === Planos ===


class PlanIn(BaseModel):
    name: str
    max_devices: int = 10
    max_users: int = 5
    code: str | None = None  # plan_code no hub de cobrança
    price_cents: int | None = None  # preço regular ("de"), em centavos
    promo_price_cents: int | None = None  # preço promocional ("por"), em centavos
    description: str | None = None
    sort_order: int = 0


class PlanPatch(BaseModel):
    name: str | None = None
    max_devices: int | None = None
    max_users: int | None = None
    code: str | None = None
    price_cents: int | None = None
    promo_price_cents: int | None = None
    description: str | None = None
    sort_order: int | None = None


def _plan(p: Plan) -> dict:
    return {
        "id": p.id, "name": p.name, "max_devices": p.max_devices, "max_users": p.max_users, "code": p.code,
        "price_cents": p.price_cents, "promo_price_cents": p.promo_price_cents,
        "description": p.description, "sort_order": p.sort_order,
    }


@router.get("/plans")
async def list_plans(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(Plan).order_by(Plan.sort_order, Plan.name))).scalars().all()
    return [_plan(p) for p in rows]


@router.post("/plans", status_code=201)
async def create_plan(payload: PlanIn, session: AsyncSession = Depends(get_session)):
    if (await session.execute(select(Plan).where(Plan.name == payload.name))).scalar_one_or_none():
        raise HTTPException(400, "plano já existe")
    p = Plan(**payload.model_dump())
    session.add(p)
    await session.commit()
    await session.refresh(p)
    return _plan(p)


@router.patch("/plans/{plan_id}")
async def update_plan(plan_id: int, payload: PlanPatch, session: AsyncSession = Depends(get_session)):
    p = (await session.execute(select(Plan).where(Plan.id == plan_id))).scalar_one_or_none()
    if p is None:
        raise HTTPException(404, "plano não encontrado")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    await session.commit()
    await session.refresh(p)
    return _plan(p)


@router.delete("/plans/{plan_id}", status_code=204)
async def delete_plan(plan_id: int, session: AsyncSession = Depends(get_session)):
    p = (await session.execute(select(Plan).where(Plan.id == plan_id))).scalar_one_or_none()
    if p is None:
        raise HTTPException(404, "plano não encontrado")
    await session.delete(p)
    await session.commit()


# === Organizações ===


class OrgIn(BaseModel):
    name: str
    plan_id: int | None = None
    device_limit: int | None = None
    plan_expires_at: date | None = None  # vencimento do plano (nulo = sem vencimento)
    admin_password: str
    admin_email: str  # obrigatório: será o login (e-mail + senha) do admin da ORG
    send_welcome: bool = False


class OrgPatch(BaseModel):
    name: str | None = None
    plan_id: int | None = None
    device_limit: int | None = None
    plan_expires_at: date | None = None
    plan_canceled: bool | None = None
    admin_email: str | None = None


def _expiry_to_dt(d: date | None) -> datetime | None:
    """Data de vencimento → fim daquele dia em UTC (plano vale o dia inteiro)."""
    return None if d is None else datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=UTC)


async def _primary_admin(session: AsyncSession, org_id: int) -> User | None:
    return (await session.execute(
        select(User).where(User.org_id == org_id, User.role == "admin").order_by(User.id).limit(1)
    )).scalar_one_or_none()


async def _org_meta(session: AsyncSession, o: Organization) -> dict:
    devices = (await session.execute(select(func.count(Device.id)).where(Device.org_id == o.id))).scalar() or 0
    users = (await session.execute(select(func.count(User.id)).where(User.org_id == o.id))).scalar() or 0
    active_users = (
        await session.execute(select(func.count(User.id)).where(User.org_id == o.id, User.is_active.is_(True)))
    ).scalar() or 0
    pl = None
    if o.plan_id is not None:
        pl = (await session.execute(select(Plan).where(Plan.id == o.plan_id))).scalar_one_or_none()
    plan = pl.name if pl else None
    limit = o.device_limit if o.device_limit is not None else (pl.max_devices if pl else None)
    user_limit = pl.max_users if pl else 0
    admin = await _primary_admin(session, o.id)
    return {
        "id": o.id, "name": o.name, "plan_id": o.plan_id, "plan": plan,
        "device_limit": limit, "user_limit": user_limit, "devices": devices, "users": users, "active_users": active_users,
        "plan_expires_at": o.plan_expires_at.date().isoformat() if o.plan_expires_at else None,
        "plan_canceled": o.plan_canceled,
        "plan_status": plan_status(o),
        "admin_username": admin.username if admin else None,
        "admin_email": admin.email if admin else None,
    }


@router.get("/orgs")
async def list_orgs(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(Organization).order_by(Organization.name))).scalars().all()
    return [await _org_meta(session, o) for o in rows]


@router.post("/orgs", status_code=201)
async def create_org(payload: OrgIn, session: AsyncSession = Depends(get_session)):
    admin_email = payload.admin_email.strip().lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", admin_email):
        raise HTTPException(400, "e-mail do admin inválido")
    pw_err = password_error(payload.admin_password)
    if pw_err:
        raise HTTPException(400, pw_err)
    if (await session.execute(select(Organization).where(Organization.name == payload.name))).scalar_one_or_none():
        raise HTTPException(400, "ORG já existe")
    if (await session.execute(select(User.id).where(func.lower(User.email) == admin_email))).first() is not None:
        raise HTTPException(400, "e-mail do admin já cadastrado")
    org = Organization(
        name=payload.name, plan_id=payload.plan_id, device_limit=payload.device_limit,
        plan_expires_at=_expiry_to_dt(payload.plan_expires_at),
    )
    session.add(org)
    await session.flush()
    admin_user = User(
        username=admin_email,  # sem username próprio: espelha o e-mail (login por e-mail)
        email=admin_email,
        password_hash=hash_password(payload.admin_password),
        role="admin",
        is_admin=True,
        org_id=org.id,
    )
    session.add(admin_user)
    await session.flush()  # garante o id p/ a notificação de boas-vindas
    await notifications.ensure_welcome(session, admin_user)
    await session.commit()
    await session.refresh(org)
    meta = await _org_meta(session, org)

    # E-mail de boas-vindas com as credenciais (via SMTP global).
    if payload.send_welcome and payload.admin_email:
        g = await _global_settings(session)
        if g.smtp_host:
            body = (
                f"Bem-vindo(a) à Aurora Prisma NetTools!\n\n"
                f"Sua organização '{org.name}' foi criada.\n\n"
                f"E-mail (login): {admin_email}\n"
                f"Senha: {payload.admin_password}\n\n"
                f"Recomendamos alterar a senha no primeiro acesso."
            )
            html = emailtpl.render(
                heading="Sua conta está pronta",
                intro=f"Bem-vindo(a) à Aurora Prisma NetTools! Sua organização “{org.name}” foi criada.\n\n"
                      f"E-mail (login): {admin_email}\nSenha: {payload.admin_password}",
                note="Recomendamos alterar a senha no primeiro acesso.",
            )
            ok, detail = await integrations.send_email(g, decrypt(g.smtp_password), payload.admin_email, "Acesso à Aurora Prisma NetTools", body, html)
            meta["welcome"] = {"ok": ok, "detail": detail}
        else:
            meta["welcome"] = {"ok": False, "detail": "SMTP global não configurado"}
    return meta


@router.patch("/orgs/{org_id}")
async def update_org(org_id: int, payload: OrgPatch, session: AsyncSession = Depends(get_session)):
    o = (await session.execute(select(Organization).where(Organization.id == org_id))).scalar_one_or_none()
    if o is None:
        raise HTTPException(404, "ORG não encontrada")
    data = payload.model_dump(exclude_unset=True)
    if "plan_expires_at" in data:  # date → datetime (fim do dia UTC)
        o.plan_expires_at = _expiry_to_dt(data.pop("plan_expires_at"))
    if "admin_email" in data:
        admin = await _primary_admin(session, o.id)
        if admin is not None:
            admin.email = data.pop("admin_email") or None
        else:
            data.pop("admin_email")
    for k, v in data.items():
        setattr(o, k, v)
    await session.commit()
    await session.refresh(o)
    return await _org_meta(session, o)


class SetUsersActiveIn(BaseModel):
    active: bool = False


@router.post("/orgs/{org_id}/users/set-active")
async def set_org_users_active(
    org_id: int, payload: SetUsersActiveIn, session: AsyncSession = Depends(get_session)
):
    """Ativa/desativa TODOS os usuários da ORG de uma vez (Master).
    Desativar bloqueia o login de todos daquela empresa; os dados ficam intactos."""
    if (await session.execute(select(Organization).where(Organization.id == org_id))).scalar_one_or_none() is None:
        raise HTTPException(404, "ORG não encontrada")
    values: dict = {"is_active": payload.active}
    if not payload.active:
        # Força logout imediato de todos (token_version + limpa refreshes Redis).
        values["token_version"] = User.token_version + 1
        user_ids = (
            await session.execute(select(User.id).where(User.org_id == org_id, User.is_active.is_(True)))
        ).scalars().all()
        for uid in user_ids:
            await sessions.revoke_all_refresh(uid)
    res = await session.execute(
        update(User).where(User.org_id == org_id, User.is_active != payload.active).values(**values)
    )
    await session.commit()
    return {"updated": res.rowcount or 0, "active": payload.active}


@router.post("/orgs/{org_id}/resend-login")
async def resend_login(org_id: int, session: AsyncSession = Depends(get_session)):
    """Gera nova senha temporária para o admin da ORG e envia por e-mail (SMTP global)."""
    admin = await _primary_admin(session, org_id)
    if admin is None:
        raise HTTPException(404, "ORG sem administrador")
    if not admin.email:
        raise HTTPException(400, "administrador sem e-mail cadastrado")
    g = await _global_settings(session)
    if not g.smtp_host:
        raise HTTPException(400, "SMTP global não configurado")
    new_password = secrets.token_urlsafe(9)
    admin.password_hash = hash_password(new_password)
    await sessions.bump_token_version(admin)
    await session.commit()
    body = (
        f"Sua senha de acesso à Aurora Prisma NetTools foi redefinida.\n\n"
        f"Usuário: {admin.username}\n"
        f"Nova senha: {new_password}\n\n"
        f"Recomendamos alterar a senha após entrar."
    )
    html = emailtpl.render(
        heading="Acesso redefinido",
        intro=f"Sua senha de acesso à Aurora Prisma NetTools foi redefinida.\n\n"
              f"Usuário: {admin.username}\nNova senha: {new_password}",
        note="Recomendamos alterar a senha após entrar.",
    )
    ok, detail = await integrations.send_email(g, decrypt(g.smtp_password), admin.email, "Redefinição de acesso — Aurora Prisma NetTools", body, html)
    return {"ok": ok, "detail": detail}


@router.delete("/orgs/{org_id}", status_code=204)
async def delete_org(org_id: int, session: AsyncSession = Depends(get_session)):
    o = (await session.execute(select(Organization).where(Organization.id == org_id))).scalar_one_or_none()
    if o is None:
        raise HTTPException(404, "ORG não encontrada")
    await session.delete(o)  # cascade: devices/sites/credenciais/usuários da ORG
    await session.commit()
