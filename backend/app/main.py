import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
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
    scan,
    racks,
    settings as settings_api,
    templates,
    user_groups,
    users,
    webhooks,
)
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.mcp.auth import MCPAuthMiddleware
from app.mcp.server import mcp
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
        poller_task = None
        if settings.poll_enabled and not settings.testing:
            poller_task = asyncio.create_task(run_poller())
        try:
            yield
        finally:
            if poller_task:
                poller_task.cancel()


app = FastAPI(title=settings.app_name, lifespan=lifespan)

# CORS — em produção restrinja allow_origins ao host do frontend (ver RUNBOOK).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.monotonic()
    response = await call_next(request)
    dur = int((time.monotonic() - start) * 1000)
    log.info("%s %s -> %s (%dms)", request.method, request.url.path, response.status_code, dur)
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    log.exception("erro não tratado em %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "erro interno do servidor"})


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(credentials.router)
app.include_router(groups.router)
app.include_router(controllers.router)
app.include_router(devices.router)
app.include_router(racks.router)
app.include_router(copilot.router)
app.include_router(mikrotik.router)
app.include_router(scan.router)
app.include_router(templates.router)
app.include_router(settings_api.router)
app.include_router(users.router)
app.include_router(user_groups.router)
app.include_router(backups.router)
app.include_router(apikeys.router)
app.include_router(webhooks.router)
app.include_router(admin.router)
app.include_router(audit.router)

# MCP built-in montado em settings.mcp_path (decisão §5), atrás do auth por X-API-Key
# que fixa o principal (ORG) para as tools escoparem por tenant.
app.mount(settings.mcp_path, MCPAuthMiddleware(mcp_app))


@app.get("/")
async def root() -> dict:
    return {"app": settings.app_name, "status": "ok"}
