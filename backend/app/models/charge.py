from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TimestampMixin


class Charge(Base, TimestampMixin):
    """Cobrança criada no hub (checkout de plano pago). É a FONTE DA VERDADE para
    reconciliar o pagamento: o poller consulta o hub por `hub_charge_id` e, ao virar
    `paid`, ativa o plano na ORG; ao `refunded`, revoga. `pending`/`expired`/`canceled`
    seguem o status do hub."""

    __tablename__ = "charge"

    id: Mapped[int] = mapped_column(primary_key=True)
    # UUID da cobrança no hub (usado para GET /v1/charges/{id}).
    hub_charge_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    org_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=True, index=True
    )
    plan_id: Mapped[int | None] = mapped_column(ForeignKey("plan.id", ondelete="SET NULL"), nullable=True)
    # pending · paid · expired · canceled · refunded · partially_refunded
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    amount_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    external_reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # URL de pagamento devolvida pelo hub — guardada p/ reaproveitar em nova
    # tentativa de checkout do mesmo (org, plano) e evitar cobrança duplicada.
    checkout_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
