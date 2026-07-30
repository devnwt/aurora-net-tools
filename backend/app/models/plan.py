from sqlalchemy import Integer, String, text
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
    # Infos do CARD (definidas pelo Master no cadastro). Preços em CENTAVOS:
    # price_cents = preço regular ("de", riscado quando há promo);
    # promo_price_cents = preço promocional ("por"). description = texto do card.
    # sort_order = ordem de exibição (menor primeiro).
    price_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    promo_price_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
