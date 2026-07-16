from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TimestampMixin


class Webhook(Base, TimestampMixin):
    """Notificação HTTP disparada em eventos (ex.: device.online/device.offline)."""

    __tablename__ = "webhook"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    url: Mapped[str] = mapped_column(String(500))
    events: Mapped[str] = mapped_column(String(200), default="")  # CSV; vazio = todos
    secret: Mapped[str] = mapped_column(String(200), default="")  # opcional (assina o corpo, HMAC-SHA256)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
