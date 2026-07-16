from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class DeviceStatus(Base):
    """Último snapshot de status/métricas de um device, preenchido pelo poller.

    Uma linha por device (device_id único). Lido pelo Dashboard/Devices sem
    precisar conectar ao equipamento.
    """

    __tablename__ = "device_status"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[int] = mapped_column(
        ForeignKey("device.id", ondelete="CASCADE"), unique=True, index=True
    )

    status: Mapped[str] = mapped_column(String(20), default="unknown")  # online/not_accessible/disabled/unknown
    cpu_load: Mapped[str | None] = mapped_column(String(16), nullable=True)
    ram_used_pct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    temperature: Mapped[str | None] = mapped_column(String(16), nullable=True)
    uptime: Mapped[str | None] = mapped_column(String(64), nullable=True)
    version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    board: Mapped[str | None] = mapped_column(String(64), nullable=True)
    current_firmware: Mapped[str | None] = mapped_column(String(64), nullable=True)
    upgrade_firmware: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
