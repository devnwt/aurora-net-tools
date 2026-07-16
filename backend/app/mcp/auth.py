"""Middleware ASGI que autentica a sessão MCP por X-API-Key e fixa o principal.

Sem chave → principal None (as tools isolam para 'nenhum recurso'). Chave sem ORG
= Master (vê tudo); chave de ORG = Administrador daquela ORG.
"""

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.security import hash_api_key
from app.mcp.context import reset_principal, set_principal
from app.models import ApiKey, User


async def _principal_from_key(token: str) -> User | None:
    async with SessionLocal() as session:
        key = (await session.execute(select(ApiKey).where(ApiKey.key_hash == hash_api_key(token)))).scalar_one_or_none()
        if key is None:
            return None
        role = "master" if key.org_id is None else "admin"
        return User(id=0, username=f"apikey:{key.name}", password_hash="", role=role, org_id=key.org_id)


class MCPAuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        token = headers.get("x-api-key")
        principal = await _principal_from_key(token) if token else None
        ctx_token = set_principal(principal)
        try:
            await self.app(scope, receive, send)
        finally:
            reset_principal(ctx_token)
