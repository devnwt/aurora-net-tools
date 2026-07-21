from sqlalchemy import Boolean, Float, ForeignKey, Integer, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.enums import ConnectionMode, DeviceType
from app.models.mixins import TimestampMixin


class Device(Base, TimestampMixin):
    """Equipamento de acesso direto (RouterOS/Cisco/Huawei). Decisão §2/§7/§8."""

    __tablename__ = "device"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120), index=True)
    ip: Mapped[str] = mapped_column(String(45), index=True)
    device_type: Mapped[DeviceType] = mapped_column(SAEnum(DeviceType, name="device_type"), index=True)
    connection_mode: Mapped[ConnectionMode] = mapped_column(
        SAEnum(ConnectionMode, name="connection_mode"), default=ConnectionMode.direct
    )
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey("device_group.id", ondelete="SET NULL"), nullable=True, index=True
    )
    rack_id: Mapped[int | None] = mapped_column(
        ForeignKey("rack.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # SSH
    ssh_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    ssh_port: Mapped[int] = mapped_column(Integer, default=22)
    ssh_credential_id: Mapped[int | None] = mapped_column(
        ForeignKey("credential.id", ondelete="SET NULL"), nullable=True
    )

    # Telnet
    telnet_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    telnet_port: Mapped[int] = mapped_column(Integer, default=23)
    telnet_credential_id: Mapped[int | None] = mapped_column(
        ForeignKey("credential.id", ondelete="SET NULL"), nullable=True
    )

    # SNMP
    snmp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    snmp_port: Mapped[int] = mapped_column(Integer, default=161)
    snmp_credential_id: Mapped[int | None] = mapped_column(
        ForeignKey("credential.id", ondelete="SET NULL"), nullable=True
    )

    # API (armazenado, sem driver no MVP — decisão §8)
    api_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    api_base_url: Mapped[str] = mapped_column(String(255), default="")
    api_credential_id: Mapped[int | None] = mapped_column(
        ForeignKey("credential.id", ondelete="SET NULL"), nullable=True
    )

    notes: Mapped[str] = mapped_column(String(1000), default="")

    # Geolocalização (para o mapa do device)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
