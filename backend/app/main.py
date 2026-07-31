import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import (
    admin,
    apikeys,
    audit,
    auth,
    backups,
    controllers,
    copilot,
    credentials,
    devices,
    groups,
    health,
    mikrotik,
    notifications,
    observability,
    org,
    plans,
    profile,
    racks,
    scan,
    templates,
    user_groups,
    users,
    webhooks,
)
from app.api import (
    settings as settings_api,
)
from app.api.deps import require_active_plan
from app.core.config import get_settings
from app.core.logging import bind_request, configure_logging, current_request_id
from app.core.metrics import setup_metrics, update_dependency_gauges
from app.mcp.auth import MCPAuthMiddleware
from app.mcp.server import mcp
from app.services.billing_reconcile import run_billing_reconciler
from app.services.notifications import run_notifier
from app.services.poller import run_poller

settings = get_settings()
configure_logging()
log = logging.getLogger("aurora")

# Cria o app ASGI do MCP (instancia o session manager de forma lazy).
mcp_app = mcp.streamable_http_app()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Inicia o session manager do MCP (streamable-http) junto com o app.
    async with mcp.session_manager.run():
        bg_tasks: list[asyncio.Task] = []
        if settings.poll_enabled and not settings.testing:
            bg_tasks.append(asyncio.create_task(run_poller()))
        if settings.notify_enabled and not settings.testing:
            bg_tasks.append(asyncio.create_task(run_notifier()))
        if settings.billing_reconcile_enabled and not settings.testing:
            bg_tasks.append(asyncio.create_task(run_billing_reconciler()))
        try:
            yield
        finally:
            for task in bg_tasks:
                task.cancel()


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

# CORS: same-origin via proxy não precisa de credentials. Dev cross-origin
# (Vite) define CORS_ORIGINS=http://localhost:5173 e COOKIE_SECURE=false.
_cors = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors or ["*"],
    allow_credentials=bool(_cors),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def refresh_metrics_deps(request: Request, call_next):
    """Atualiza gauges Postgres/Redis no scrape de /metrics (baixo custo)."""
    if settings.metrics_enabled and request.url.path == "/metrics":
        await update_dependency_gauges()
    return await call_next(request)


@app.middleware("http")
async def csrf_cookie_guard(request: Request, call_next):
    """Bloqueia mutações autenticadas só por cookie sem header do SPA (CSRF).

    Bearer / X-API-Key seguem sem o header (clientes de API). SameSite=Lax já
    mitiga a maior parte; o header custom impede POSTs cross-site clássicos.
    Fluxos públicos de auth (login/cadastro/reset) ficam de fora — o SPA ainda
    envia o header, mas clientes/testes sem cookie jar limpo não quebram.
    """
    from app.core.cookies import ACCESS_COOKIE, CLIENT_HEADER, CLIENT_WEB, REFRESH_COOKIE

    _csrf_exempt = {
        "/auth/login",
        "/auth/register",
        "/auth/verify-email",
        "/auth/complete-registration",
        "/auth/resend-code",
        "/auth/forgot-password",
        "/auth/reset-password",
        "/auth/accept-invite",
        "/auth/reactivate",
        "/auth/registration-status",
    }
    if request.method not in ("GET", "HEAD", "OPTIONS", "TRACE"):
        if request.url.path not in _csrf_exempt:
            has_bearer = bool(request.headers.get("authorization"))
            has_api_key = bool(request.headers.get("x-api-key"))
            has_cookie = bool(
                request.cookies.get(ACCESS_COOKIE) or request.cookies.get(REFRESH_COOKIE)
            )
            if has_cookie and not has_bearer and not has_api_key:
                if request.headers.get(CLIENT_HEADER, "").lower() != CLIENT_WEB:
                    return JSONResponse({"detail": "CSRF rejeitado"}, status_code=403)
    return await call_next(request)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Correlaciona a requisição e alimenta a observabilidade.

    Abre o contexto de log (request id + rota) que TODO log emitido durante a
    requisição herda — inclusive os de `app/services/*`. O usuário entra depois,
    quando `get_current_user` resolve quem é (ver `bind_user`).
    """
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:16]
    ctx = bind_request(request_id, request.method, request.url.path)

    start = time.monotonic()
    response = await call_next(request)
    dur = int((time.monotonic() - start) * 1000)
    ctx["status"] = response.status_code

    log.info("%s %s -> %s (%dms)", request.method, request.url.path, response.status_code, dur)
    # 5xx sem exceção (ex.: HTTPException(500) de um driver) não passa pelo
    # handler abaixo — sem isto o erro sumiria da aba Observabilidade.
    if response.status_code >= 500:
        log.error(
            "resposta %s em %s %s (%dms)",
            response.status_code,
            request.method,
            request.url.path,
            dur,
            extra={"status_code": response.status_code, "duration_ms": dur},
        )

    response.headers["X-Request-ID"] = request_id
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    log.exception("erro não tratado em %s %s", request.method, request.url.path)
    # O request id volta pro cliente: é por ele que o Master acha o evento (e o
    # stack trace) na aba Observabilidade, sem expor nada técnico na resposta.
    request_id = current_request_id()
    body: dict[str, str] = {"detail": "erro interno do servidor"}
    if request_id:
        body["request_id"] = request_id
    return JSONResponse(status_code=500, content=body)


# Rotas SEMPRE acessíveis (mesmo SEM PLANO): login, planos (pagar), perfil,
# notificações, saúde e a administração master.
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(plans.router)
app.include_router(org.router)
app.include_router(notifications.router)
app.include_router(profile.router)

# Rotas de DADOS: bloqueadas quando a ORG está SEM PLANO ATIVO (sem plano ou
# vencido) — o guard devolve 403 {code: plan_required} e o front abre o popup.
_gated = [Depends(require_active_plan)]
app.include_router(credentials.router, dependencies=_gated)
app.include_router(groups.router, dependencies=_gated)
app.include_router(controllers.router, dependencies=_gated)
app.include_router(devices.router, dependencies=_gated)
app.include_router(racks.router, dependencies=_gated)
app.include_router(copilot.router, dependencies=_gated)
app.include_router(mikrotik.router, dependencies=_gated)
app.include_router(scan.router, dependencies=_gated)
app.include_router(templates.router, dependencies=_gated)
app.include_router(settings_api.router, dependencies=_gated)
app.include_router(users.router, dependencies=_gated)
app.include_router(user_groups.router, dependencies=_gated)
app.include_router(backups.router, dependencies=_gated)
app.include_router(apikeys.router, dependencies=_gated)
app.include_router(webhooks.router, dependencies=_gated)
app.include_router(audit.router, dependencies=_gated)
app.include_router(observability.router, dependencies=_gated)

# Prometheus RED + /metrics (depois das rotas, para rotular handlers corretamente).
if settings.metrics_enabled:
    setup_metrics(app)

# MCP built-in montado em settings.mcp_path (decisão §5), atrás do auth por X-API-Key
# que fixa o principal (ORG) para as tools escoparem por tenant.
app.mount(settings.mcp_path, MCPAuthMiddleware(mcp_app))


@app.get("/")
async def root() -> dict:
    return {"app": settings.app_name, "status": "ok"}
