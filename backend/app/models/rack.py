from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TimestampMixin


class Rack(Base, TimestampMixin):
    """Rack dentro de um Site. Devices pertencem a um rack (Site → Rack → Device)."""

    __tablename__ = "rack"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=True, index=True
    )
    site_id: Mapped[int] = mapped_column(ForeignKey("device_group.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(String(300), default="")


class RackLink(Base, TimestampMixin):
    """Ligação física entre dois racks, indicando as interfaces de cada ponta."""

    __tablename__ = "rack_link"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=True, index=True
    )
    rack_a_id: Mapped[int] = mapped_column(ForeignKey("rack.id", ondelete="CASCADE"), index=True)
    rack_b_id: Mapped[int] = mapped_column(ForeignKey("rack.id", ondelete="CASCADE"), index=True)
    iface_a: Mapped[str] = mapped_column(String(64), default="")
    iface_b: Mapped[str] = mapped_column(String(64), default="")
