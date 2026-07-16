from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(120), unique=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)  # p/ e-mails de acesso
    password_hash: Mapped[str] = mapped_column(String(255))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    # Papel: master (sistema) · admin (dono da ORG) · operator (usuário da ORG).
    role: Mapped[str] = mapped_column(String(20), default="operator")
    org_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=True, index=True
    )
    usergroup_id: Mapped[int | None] = mapped_column(
        ForeignKey("user_group.id", ondelete="SET NULL"), nullable=True, index=True
    )
