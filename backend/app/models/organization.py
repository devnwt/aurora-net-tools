from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, text
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
    # Vencimento do plano (nulo = sem vencimento). Vencido: bloqueia novas criações.
    plan_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Cancelado: mantém acesso até `plan_expires_at`, mas não renova (reversível).
    plan_canceled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"), nullable=False)
    # Prazo de elegibilidade ao teste (gravado uma vez na criação da conta, ~1 semana).
    # Passado o prazo, a ORG não pode mais ESCOLHER o plano de teste (independe do plano atual).
    trial_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
