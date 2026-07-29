"""Proteção de login: rate limiting, lockout de conta e backoff progressivo.

Contadores ficam no Redis (mesmo cliente do connlock/cache), com TTL por janela.
Decisões de projeto:

- **Atômico**: INCR + EXPIRE num único script Lua, evitando a corrida "incrementou
  mas não expirou" (que deixaria um contador preso sem TTL).
- **Fail-open**: se o Redis estiver indisponível, o login NÃO trava para todo mundo
  — as checagens liberam e apenas registram um aviso. Disponibilidade > bloqueio.
- **Sem enumeração**: credencial inválida continua devolvendo o mesmo 401 genérico;
  o bloqueio devolve 429 com Retry-After (o próprio atacante gerou o volume).
- **Proxy-aware**: atrás do Caddy, o IP real vem em X-Forwarded-For/X-Real-IP.
- **Auditoria**: bloqueios e falhas vão para o logger `aurora.security` (aba
  Observabilidade), com IP/identificador/contagem — nunca a senha.
"""

import asyncio
import logging

from fastapi import HTTPException, Request, status

from app.core.config import get_settings
from app.core.redis import redis_client

log = logging.getLogger("aurora.security")
settings = get_settings()

# INCR e define TTL só quando o contador nasce (1ª ocorrência da janela), atômico.
_INCR_LUA = "local c = redis.call('INCR', KEYS[1])\nif c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end\nreturn c"
_incr_script = redis_client.register_script(_INCR_LUA)


def _enabled() -> bool:
    # Desliga em testes (contadores de Redis não devem interferir na suíte),
    # a menos que explicitamente reativado.
    return settings.login_protection_enabled and not settings.testing


def client_ip(request: Request) -> str:
    """IP real do cliente considerando o proxy (Caddy seta X-Forwarded-For)."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    xr = request.headers.get("x-real-ip")
    if xr:
        return xr.strip()
    return request.client.host if request.client else "unknown"


def _ident_key(ident: str) -> str:
    return ident.strip().lower()


async def _incr(key: str, window: int) -> int:
    """Incremento atômico com TTL. Fail-open: 0 se o Redis falhar (nunca bloqueia)."""
    try:
        return int(await _incr_script(keys=[key], args=[window]))
    except Exception as e:  # Redis fora do ar → não trava o login
        log.warning("proteção de login degradada (Redis indisponível, fail-open): %s", e)
        return 0


async def _ttl(key: str) -> int:
    try:
        t = await redis_client.ttl(key)
        return t if isinstance(t, int) and t > 0 else 0
    except Exception:
        return 0


async def _exists(key: str) -> bool:
    try:
        return bool(await redis_client.exists(key))
    except Exception:
        return False


async def _clear(*keys: str) -> None:
    try:
        await redis_client.delete(*keys)
    except Exception:
        pass


def _too_many(retry_after: int) -> HTTPException:
    ra = max(int(retry_after), 1)
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Muitas tentativas. Tente novamente mais tarde.",
        headers={"Retry-After": str(ra)},
    )


# === Chaves ===
def _ip_key(ip: str) -> str:
    return f"rl:login:ip:{ip}"


def _acct_key(ident: str) -> str:
    return f"rl:login:acct:{ident}"


def _lock_key(ident: str) -> str:
    return f"lock:login:acct:{ident}"


def _authip_key(ip: str) -> str:
    return f"rl:auth:ip:{ip}"


# === API usada pelos endpoints ===
async def before_login(request: Request, ident: str) -> None:
    """Antes de checar a senha: barra se a conta está bloqueada ou o IP estourou o
    limite. Conta esta tentativa no limite por IP. Levanta 429 quando aplicável."""
    if not _enabled():
        return
    ip = client_ip(request)
    key = _ident_key(ident)

    # 1) Conta bloqueada (lockout temporário) — vale para qualquer IP.
    if key and await _exists(_lock_key(key)):
        ra = await _ttl(_lock_key(key))
        log.warning("login bloqueado: conta em lockout ident=%s ip=%s retry_after=%ss", key, ip, ra)
        raise _too_many(ra)

    # 2) Rate limit por IP (conta a tentativa atual).
    count = await _incr(_ip_key(ip), settings.login_ip_window_seconds)
    if count > settings.login_ip_max_attempts:
        ra = await _ttl(_ip_key(ip))
        log.warning("login bloqueado: IP acima do limite ip=%s tentativas=%s retry_after=%ss", ip, count, ra)
        raise _too_many(ra)


async def on_login_failure(request: Request, ident: str) -> int | None:
    """Após senha incorreta: conta a falha. Se atingir o limite, aplica o lockout e
    levanta 429. Caso contrário devolve quantas tentativas ainda RESTAM antes do
    bloqueio (None quando a proteção está desligada) — usado para avisar o usuário."""
    if not _enabled():
        return None
    ip = client_ip(request)
    key = _ident_key(ident)
    fails = await _incr(_acct_key(key), settings.login_account_window_seconds)
    remaining = max(0, settings.login_account_max_failures - fails)

    async def _backoff() -> None:
        delay = min(fails * 0.4, settings.login_backoff_max_seconds)
        if delay > 0:
            await asyncio.sleep(delay)

    if fails and fails >= settings.login_account_max_failures:
        try:
            await redis_client.set(_lock_key(key), "1", ex=settings.login_lockout_seconds)
        except Exception:
            pass
        log.warning(
            "conta bloqueada por %ss após %s falhas ident=%s ip=%s",
            settings.login_lockout_seconds, fails, key, ip,
        )
        await _backoff()
        raise _too_many(settings.login_lockout_seconds)  # lockout: já responde 429

    log.info("login falhou ident=%s ip=%s falhas=%s (restam %s)", key, ip, fails, remaining)
    await _backoff()
    return remaining


async def on_login_success(ident: str) -> None:
    """Senha correta: zera contador de falhas e remove o lockout da conta."""
    if not _enabled():
        return
    key = _ident_key(ident)
    await _clear(_acct_key(key), _lock_key(key))


async def guard_auth_endpoint(request: Request) -> None:
    """Rate limit genérico por IP para endpoints sensíveis correlatos
    (forgot-password/reset-password/register/reactivate). Levanta 429 se estourar."""
    if not _enabled():
        return
    ip = client_ip(request)
    count = await _incr(_authip_key(ip), settings.auth_ip_window_seconds)
    if count > settings.auth_ip_max_requests:
        ra = await _ttl(_authip_key(ip))
        log.warning("endpoint de auth bloqueado por IP ip=%s req=%s retry_after=%ss", ip, count, ra)
        raise _too_many(ra)
