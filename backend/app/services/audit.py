"""Registro de auditoria de execuções (decisão §11)."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog
from app.models.enums import Classification, Protocol, TargetKind

_SUMMARY_MAX = 2000


async def record(
    session: AsyncSession,
    *,
    actor: str,
    target_kind: TargetKind,
    target_id: int,
    protocol: Protocol,
    command: str,
    classification: Classification,
    ok: bool,
    error: str | None,
    duration_ms: int,
    output: str = "",
    org_id: int | None = None,
) -> None:
    session.add(
        AuditLog(
            org_id=org_id,
            actor=actor,
            target_kind=target_kind,
            target_id=target_id,
            protocol=protocol,
            command=command,
            classification=classification,
            ok=ok,
            error=error,
            duration_ms=duration_ms,
            output_summary=(output or "")[:_SUMMARY_MAX],
        )
    )
    await session.commit()
