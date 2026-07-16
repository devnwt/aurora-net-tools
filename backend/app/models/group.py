from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TimestampMixin


class DeviceGroup(Base, TimestampMixin):
    """Grupo de equipamentos com credenciais-padrão herdáveis (decisão §7)."""

    __tablename__ = "device_group"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    location: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(String(500), default="")
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)

    default_ssh_credential_id: Mapped[int | None] = mapped_column(
        ForeignKey("credential.id", ondelete="SET NULL"), nullable=True
    )
    default_telnet_credential_id: Mapped[int | None] = mapped_column(
        ForeignKey("credential.id", ondelete="SET NULL"), nullable=True
    )
    default_snmp_credential_id: Mapped[int | None] = mapped_column(
        ForeignKey("credential.id", ondelete="SET NULL"), nullable=True
    )
    default_api_credential_id: Mapped[int | None] = mapped_column(
        ForeignKey("credential.id", ondelete="SET NULL"), nullable=True
    )
