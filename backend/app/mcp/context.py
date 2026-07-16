"""Principal (ORG/papel) da sessão MCP corrente, preenchido pelo middleware de auth.

Usa ContextVar — propagado às tasks filhas (Python copia o contexto ao criar task),
então as tools MCP enxergam o principal setado no middleware ASGI do request.
"""

from contextvars import ContextVar

from app.models import User

_principal: ContextVar["User | None"] = ContextVar("mcp_principal", default=None)


def set_principal(user: "User | None"):
    return _principal.set(user)


def reset_principal(token) -> None:
    _principal.reset(token)


def get_principal() -> "User | None":
    return _principal.get()
