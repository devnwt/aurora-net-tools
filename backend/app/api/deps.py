from datetime import UTC, datetime

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import decode_access_token, hash_api_key
from app.models import ApiKey, User

# auto_error=False: sem bearer, deixamos a chave de API (X-API-Key) tentar autenticar.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

_UNAUTH = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Não autenticado",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    x_api_key: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> User:
    # 1) JWT (login de usuário)
    if token:
        username = decode_access_token(token)
        if username:
            user = (await session.execute(select(User).where(User.username == username))).scalar_one_or_none()
            if user is not None:
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
            return User(id=0, username=f"apikey:{key.name}", password_hash="", is_admin=True, role=role, org_id=key.org_id)

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
