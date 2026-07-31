"""Cookies de sessão HttpOnly (AUTH-003).

Access + refresh ficam inacessíveis a JavaScript. Path/Secure/SameSite via settings.
O SPA (mesma origem via Caddy) envia `credentials: include` + `X-Aurora-Client: web`.
"""

from __future__ import annotations

from fastapi import Request, Response
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.services.sessions import TokenPair, pair_response

settings = get_settings()

ACCESS_COOKIE = "aurora_at"
REFRESH_COOKIE = "aurora_rt"
# "Lembrar de mim": guarda a escolha de persistência (1=persistente, 0=sessão) com a
# MESMA persistência dos cookies de auth, para o /auth/refresh honrar a decisão.
PERSIST_COOKIE = "aurora_persist"
CLIENT_HEADER = "x-aurora-client"
CLIENT_WEB = "web"


def _refresh_max_age() -> int:
    return max(60, int(settings.jwt_refresh_expire_days * 86400))


def _cookie_kwargs(max_age: int | None) -> dict:
    # max_age=None → cookie de SESSÃO (apagado ao fechar o navegador).
    kw = {
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_samesite,
        "path": settings.cookie_path,
    }
    if max_age is not None:
        kw["max_age"] = max_age
    return kw


def attach_auth_cookies(response: Response, pair: TokenPair, remember: bool = True) -> None:
    # remember=False → cookies de sessão (sem max_age): a sessão cai ao fechar o navegador.
    access_age = pair.expires_in if remember else None
    refresh_age = _refresh_max_age() if remember else None
    response.set_cookie(ACCESS_COOKIE, pair.access_token, **_cookie_kwargs(access_age))
    response.set_cookie(REFRESH_COOKIE, pair.refresh_token, **_cookie_kwargs(refresh_age))
    response.set_cookie(PERSIST_COOKIE, "1" if remember else "0", **_cookie_kwargs(refresh_age))


def clear_auth_cookies(response: Response) -> None:
    for name in (ACCESS_COOKIE, REFRESH_COOKIE, PERSIST_COOKIE):
        response.delete_cookie(
            name,
            path=settings.cookie_path,
            secure=settings.cookie_secure,
            httponly=True,
            samesite=settings.cookie_samesite,
        )


def is_web_client(request: Request) -> bool:
    return request.headers.get(CLIENT_HEADER, "").lower() == CLIENT_WEB


def token_response(request: Request, pair: TokenPair, remember: bool | None = None) -> JSONResponse:
    """JSON + Set-Cookie. Cliente web NÃO recebe os tokens no body (só cookies).

    `remember=None` (ex.: no /auth/refresh) herda a escolha do cookie aurora_persist
    para preservar cookies de sessão vs persistentes ao renovar o token."""
    if remember is None:
        remember = request.cookies.get(PERSIST_COOKIE, "1") != "0"
    if is_web_client(request):
        body = {"ok": True, "token_type": "bearer", "expires_in": pair.expires_in}
    else:
        body = pair_response(pair)
    resp = JSONResponse(body)
    attach_auth_cookies(resp, pair, remember=remember)
    return resp


def read_access_token(request: Request, bearer: str | None) -> str | None:
    if bearer:
        return bearer
    return request.cookies.get(ACCESS_COOKIE)


def read_refresh_token(request: Request, body_token: str | None) -> str | None:
    if body_token:
        return body_token
    return request.cookies.get(REFRESH_COOKIE)
