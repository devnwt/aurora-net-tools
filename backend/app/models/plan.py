from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TimestampMixin


class Plan(Base, TimestampMixin):
    """Plano de assinatura — define os limites de uma ORG (nº de devices/usuários)."""

    __tablename__ = "plan"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    max_devices: Mapped[int] = mapped_column(Integer, default=10)
    max_users: Mapped[int] = mapped_column(Integer, default=5)
    # Código do plano no hub de cobrança (o `plan_code` da API de charges).
    # Necessário para o checkout de um plano pago; definido pelo Master.
    code: Mapped[str | None] = mapped_column(String(60), nullable=True)
