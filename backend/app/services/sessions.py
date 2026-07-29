"""Sessões JWT: access curto + refresh opaco no Redis + denylist por jti.

Chaves Redis (TTL em todos os valores):
  sess:deny:{jti}     — access revogado até expirar
  sess:rt:{sha256}    — refresh ativo → "user_id:ver:jti:access_exp"
  sess:uid:{user_id}  — SET dos hashes de refresh do usuário (logout-all)
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime

from jose import JWTError, jwt

from app.core.config import get_settings
from app.core.redis import redis_client
from app.core.security import create_access_token
from app.models import User

log = logging.getLogger("aurora.auth")
settings = get_settings()


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int


@dataclass(frozen=True)
class AccessClaims:
    sub: str
    jti: str
    ver: int
    exp: int


@dataclass(frozen=True)
class RefreshRecord:
    user_id: int
    ver: int
    access_jti: str
    access_exp: int
    token_hash: str


def _rt_key(token_hash: str) -> str:
    return f"sess:rt:{token_hash}"


def _uid_key(user_id: int) -> str:
    return f"sess:uid:{user_id}"


def _deny_key(jti: str) -> str:
    return f"sess:deny:{jti}"


def _hash_refresh(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _refresh_ttl() -> int:
    return max(60, int(settings.jwt_refresh_expire_days * 86400))


def decode_access_claims(token: str) -> AccessClaims | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
    if payload.get("typ", "access") != "access":
        return None
    sub = payload.get("sub")
    jti = payload.get("jti")
    if not sub or not jti:
        return None
    try:
        ver = int(payload.get("ver", 0))
        exp = int(payload["exp"])
    except (TypeError, ValueError, KeyError):
        return None
    return AccessClaims(sub=sub, jti=jti, ver=ver, exp=exp)


async def is_access_denied(jti: str) -> bool:
    try:
        return bool(await redis_client.exists(_deny_key(jti)))
    except Exception as e:
        log.warning("denylist indisponível (fail-open): %s", e)
        return False


async def deny_access(jti: str, exp: int) -> None:
    """Coloca o access jti na denylist até o exp original."""
    ttl = max(1, exp - int(datetime.now(UTC).timestamp()))
    try:
        await redis_client.set(_deny_key(jti), "1", ex=ttl)
    except Exception as e:
        log.warning("falha ao denylist jti=%s: %s", jti, e)


async def issue_token_pair(user: User) -> TokenPair:
    jti = secrets.token_urlsafe(16)
    ver = int(user.token_version or 0)
    access = create_access_token(user.username, jti=jti, ver=ver)
    claims = decode_access_claims(access)
    access_exp = claims.exp if claims else int(datetime.now(UTC).timestamp()) + settings.jwt_expire_minutes * 60
    refresh = secrets.token_urlsafe(32)
    token_hash = _hash_refresh(refresh)
    ttl = _refresh_ttl()
    try:
        pipe = redis_client.pipeline()
        pipe.set(_rt_key(token_hash), f"{user.id}:{ver}:{jti}:{access_exp}", ex=ttl)
        pipe.sadd(_uid_key(user.id), token_hash)
        pipe.expire(_uid_key(user.id), ttl)
        await pipe.execute()
    except Exception as e:
        log.warning("falha ao gravar refresh user_id=%s: %s", user.id, e)
    return TokenPair(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.jwt_expire_minutes * 60,
    )


def pair_response(pair: TokenPair) -> dict:
    return {
        "access_token": pair.access_token,
        "refresh_token": pair.refresh_token,
        "token_type": "bearer",
        "expires_in": pair.expires_in,
    }


async def load_refresh(token: str) -> RefreshRecord | None:
    token_hash = _hash_refresh(token)
    try:
        raw = await redis_client.get(_rt_key(token_hash))
    except Exception as e:
        log.warning("falha ao ler refresh: %s", e)
        return None
    if not raw:
        return None
    parts = raw.split(":")
    if len(parts) != 4:
        return None
    try:
        return RefreshRecord(
            user_id=int(parts[0]),
            ver=int(parts[1]),
            access_jti=parts[2],
            access_exp=int(parts[3]),
            token_hash=token_hash,
        )
    except ValueError:
        return None


async def revoke_refresh(token: str) -> RefreshRecord | None:
    """Remove o refresh; devolve o registro se existia (p/ denylist do access)."""
    rec = await load_refresh(token)
    if rec is None:
        return None
    try:
        pipe = redis_client.pipeline()
        pipe.delete(_rt_key(rec.token_hash))
        pipe.srem(_uid_key(rec.user_id), rec.token_hash)
        await pipe.execute()
    except Exception as e:
        log.warning("falha ao revogar refresh: %s", e)
    return rec


async def revoke_all_refresh(user_id: int) -> None:
    key = _uid_key(user_id)
    try:
        hashes = await redis_client.smembers(key)
        if hashes:
            pipe = redis_client.pipeline()
            for h in hashes:
                pipe.delete(_rt_key(h))
            pipe.delete(key)
            await pipe.execute()
        else:
            await redis_client.delete(key)
    except Exception as e:
        log.warning("falha ao limpar refreshes user_id=%s: %s", user_id, e)


async def bump_token_version(user: User) -> None:
    """Invalida todos os access (via ver) e apaga refreshes do usuário."""
    user.token_version = int(user.token_version or 0) + 1
    await revoke_all_refresh(user.id)
