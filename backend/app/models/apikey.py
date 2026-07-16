from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TimestampMixin


class ApiKey(Base, TimestampMixin):
    """Chave de API para acesso programático (header X-API-Key). Só o hash é guardado."""

    __tablename__ = "api_key"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    prefix: Mapped[str] = mapped_column(String(16), index=True)  # ex.: "ak_AbC123" (identificação)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # sha256 hex
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
