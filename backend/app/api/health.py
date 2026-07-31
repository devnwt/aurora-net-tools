from fastapi import APIRouter

from app.core.config import get_settings
from app.core.metrics import update_dependency_gauges

router = APIRouter(tags=["health"])
settings = get_settings()


@router.get("/health")
async def health() -> dict:
    deps = await update_dependency_gauges()
    status = "ok" if deps["database"] and deps["redis"] else "degraded"
    return {
        "status": status,
        "version": settings.app_version,
        "database": deps["database"],
        "redis": deps["redis"],
    }
