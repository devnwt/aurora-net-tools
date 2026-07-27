from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TimestampMixin


class Notification(Base, TimestampMixin):
    """Notificação destinada a UM usuário (status de leitura individual).

    `org_id` acompanha o dono para reforçar o isolamento por empresa. A unicidade
    (user_id, dedup_key) garante idempotência: cada evento (boas-vindas, faixa de
    trial/expiração) só gera uma notificação por usuário.
    """

    __tablename__ = "notification"
    __table_args__ = (UniqueConstraint("user_id", "dedup_key", name="uq_notification_user_dedup"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), index=True)
    org_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(32), default="info")  # welcome | trial | plan | info
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    # Chave de deduplicação por usuário: "welcome" | "trial:<data>:<faixa>" | "plan:<data>:<faixa>".
    dedup_key: Mapped[str] = mapped_column(String(120), index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
