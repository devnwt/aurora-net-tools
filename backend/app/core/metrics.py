"""Métricas Prometheus de baixo impacto (OBS-001).

- RED (rate/errors/duration) via prometheus-fastapi-instrumentator
- Gauges de dependência (Postgres/Redis) atualizados no scrape de /metrics
  e em cada GET /health
"""

from __future__ import annotations

import logging

from prometheus_client import Gauge
from sqlalchemy import text

from app.core.db import engine
from app.core.redis import redis_client

log = logging.getLogger("aurora.metrics")

# 1 = saudável, 0 = indisponível
dependency_up = Gauge(
    "aurora_dependency_up",
    "Dependência externa saudável (1) ou fora (0)",
    ["name"],
)

# App up (sempre 1 enquanto o processo responde /metrics)
app_up = Gauge("aurora_up", "Processo da API no ar (1)")


async def update_dependency_gauges() -> dict[str, bool]:
    """Ping Postgres e Redis; atualiza gauges. Nunca levanta."""
    app_up.set(1)
    db_ok = False
    redis_ok = False
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception as e:
        log.debug("gauge postgres down: %s", e)
    try:
        redis_ok = bool(await redis_client.ping())
    except Exception as e:
        log.debug("gauge redis down: %s", e)
    dependency_up.labels(name="postgres").set(1 if db_ok else 0)
    dependency_up.labels(name="redis").set(1 if redis_ok else 0)
    return {"database": db_ok, "redis": redis_ok}


def setup_metrics(app) -> None:
    """Instrumenta a app e expõe GET /metrics (sem auth — scrape interno/rede privada)."""
    from prometheus_fastapi_instrumentator import Instrumentator

    instrumentator = Instrumentator(
        should_group_status_codes=True,
        should_ignore_untemplated=True,
        excluded_handlers=["/metrics", "/health", "/"],
    )
    instrumentator.instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
