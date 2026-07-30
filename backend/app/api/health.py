from fastapi import APIRouter

from app.core.metrics import update_dependency_gauges

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    deps = await update_dependency_gauges()
    status = "ok" if deps["database"] and deps["redis"] else "degraded"
    return {"status": status, "database": deps["database"], "redis": deps["redis"]}
