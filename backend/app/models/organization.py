from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TimestampMixin


class Organization(Base, TimestampMixin):
    """ORG (tenant). Todos os recursos (devices/sites/credenciais/usuários) são isolados por ORG."""

    __tablename__ = "organization"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    plan_id: Mapped[int | None] = mapped_column(ForeignKey("plan.id", ondelete="SET NULL"), nullable=True)
    # Override opcional do limite do plano (se nulo, usa o do plano).
    device_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
