"""Lock de conexão por alvo no Redis — serializa execuções no mesmo equipamento (decisão §3/§4)."""

import contextlib

from app.core.redis import redis_client

LOCK_TTL_SECONDS = 60


class TargetBusy(Exception):
    pass


@contextlib.asynccontextmanager
async def target_lock(target_kind: str, target_id: int):
    key = f"lock:{target_kind}:{target_id}"
    acquired = await redis_client.set(key, "1", nx=True, ex=LOCK_TTL_SECONDS)
    if not acquired:
        raise TargetBusy(f"{target_kind} {target_id} já tem uma execução em andamento")
    try:
        yield
    finally:
        await redis_client.delete(key)
