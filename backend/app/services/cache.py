"""Cache de TTL curto no Redis para consultas pesadas (decisão §3)."""

import json

from app.core.redis import redis_client


async def cached(key: str, ttl: int, producer):
    """Retorna o valor cacheado em `key` ou produz, cacheia (TTL) e retorna.

    `producer` é uma coroutine sem argumentos. Valores são serializados em JSON.
    """
    hit = await redis_client.get(key)
    if hit is not None:
        return json.loads(hit)
    value = await producer()
    await redis_client.set(key, json.dumps(value, default=str), ex=ttl)
    return value
