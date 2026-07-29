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
CLIENT_HEADER = "x-aurora-client"
CLIENT_WEB = "web"


def _refresh_max_age() -> int:
    return max(60, int(settings.jwt_refresh_expire_days * 86400))


def _cookie_kwargs(max_age: int) -> dict:
    return {
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_samesite,
        "path": settings.cookie_path,
        "max_age": max_age,
    }


def attach_auth_cookies(response: Response, pair: TokenPair) -> None:
    response.set_cookie(ACCESS_COOKIE, pair.access_token, **_cookie_kwargs(pair.expires_in))
    response.set_cookie(REFRESH_COOKIE, pair.refresh_token, **_cookie_kwargs(_refresh_max_age()))


def clear_auth_cookies(response: Response) -> None:
    for name in (ACCESS_COOKIE, REFRESH_COOKIE):
        response.delete_cookie(
            name,
            path=settings.cookie_path,
            secure=settings.cookie_secure,
            httponly=True,
            samesite=settings.cookie_samesite,
        )


def is_web_client(request: Request) -> bool:
    return request.headers.get(CLIENT_HEADER, "").lower() == CLIENT_WEB


def token_response(request: Request, pair: TokenPair) -> JSONResponse:
    """JSON + Set-Cookie. Cliente web NÃO recebe os tokens no body (só cookies)."""
    if is_web_client(request):
        body = {"ok": True, "token_type": "bearer", "expires_in": pair.expires_in}
    else:
        body = pair_response(pair)
    resp = JSONResponse(body)
    attach_auth_cookies(resp, pair)
    return resp


def read_access_token(request: Request, bearer: str | None) -> str | None:
    if bearer:
        return bearer
    return request.cookies.get(ACCESS_COOKIE)


def read_refresh_token(request: Request, body_token: str | None) -> str | None:
    if body_token:
        return body_token
    return request.cookies.get(REFRESH_COOKIE)
