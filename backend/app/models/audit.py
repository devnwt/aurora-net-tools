from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.enums import Classification, Protocol, TargetKind


class AuditLog(Base):
    """Registro de toda execução contra a rede (decisão §11)."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=True, index=True
    )
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor: Mapped[str] = mapped_column(String(120), index=True)  # "user:<id>" ou "mcp"
    target_kind: Mapped[TargetKind] = mapped_column(SAEnum(TargetKind, name="target_kind"))
    target_id: Mapped[int] = mapped_column(Integer, index=True)
    protocol: Mapped[Protocol] = mapped_column(SAEnum(Protocol, name="protocol"))
    command: Mapped[str] = mapped_column(Text)
    classification: Mapped[Classification] = mapped_column(
        SAEnum(Classification, name="classification")
    )
    ok: Mapped[bool] = mapped_column(Boolean)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    output_summary: Mapped[str] = mapped_column(Text, default="")
