from datetime import UTC, datetime

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cookies import read_access_token
from app.core.db import get_session
from app.core.logging import bind_user
from app.core.security import hash_api_key
from app.models import ApiKey, User
from app.services import sessions

# auto_error=False: sem bearer, deixamos cookie ou X-API-Key autenticar.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

_UNAUTH = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Não autenticado",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    x_api_key: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> User:
    # 1) JWT — Authorization Bearer OU cookie HttpOnly aurora_at.
    raw = read_access_token(request, token)
    if raw:
        claims = sessions.decode_access_claims(raw)
        if claims and not await sessions.is_access_denied(claims.jti):
            user = (await session.execute(select(User).where(User.username == claims.sub))).scalar_one_or_none()
            if user is not None:
                if not user.is_active:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN, detail="Conta desativada"
                    )
                if int(user.token_version or 0) != claims.ver:
                    raise _UNAUTH
                bind_user(user=user.username, user_id=user.id, org_id=user.org_id)
                return user

    # 2) Chave de API (acesso programático) — atua como principal admin de serviço.
    if x_api_key:
        key = (
            await session.execute(select(ApiKey).where(ApiKey.key_hash == hash_api_key(x_api_key)))
        ).scalar_one_or_none()
        if key is not None:
            key.last_used_at = datetime.now(UTC)
            await session.commit()
            role = "master" if key.org_id is None else "admin"
            bind_user(user=f"apikey:{key.name}", org_id=key.org_id)
            return User(
                id=0, username=f"apikey:{key.name}", password_hash="", is_admin=True,
                is_active=True, role=role, org_id=key.org_id, token_version=0,
            )

    raise _UNAUTH


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """Master ou Administrador da ORG."""
    if user.role not in ("master", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="requer administrador")
    return user


async def require_master(user: User = Depends(get_current_user)) -> User:
    """Somente Master (administração do sistema)."""
    if user.role != "master":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="requer administrador master")
    return user
