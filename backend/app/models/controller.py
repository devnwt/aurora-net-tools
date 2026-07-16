from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.enums import ControllerKind
from app.models.mixins import TimestampMixin


class Controller(Base, TimestampMixin):
    """EMS/controladora que intermedia o acesso a elementos (ex.: UNM2000). Decisão §2."""

    __tablename__ = "controller"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[ControllerKind] = mapped_column(SAEnum(ControllerKind, name="controller_kind"))
    host: Mapped[str] = mapped_column(String(255))
    port: Mapped[int] = mapped_column(Integer)
    credential_id: Mapped[int | None] = mapped_column(
        ForeignKey("credential.id", ondelete="SET NULL"), nullable=True
    )
