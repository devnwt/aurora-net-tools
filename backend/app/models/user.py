from sqlalchemy import Boolean, ForeignKey, String, Text, text
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
    # Conta ativa: inativa (False) não consegue autenticar (login e token bloqueados).
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"), nullable=False)
    # Telefone de contato (armazenado como digitado/formatado; opcional).
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # Foto de perfil (data URL base64, imagem pequena redimensionada no cliente).
    photo: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Papel: master (sistema) · admin (dono da ORG) · operator (usuário da ORG).
    role: Mapped[str] = mapped_column(String(20), default="operator")
    org_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=True, index=True
    )
    usergroup_id: Mapped[int | None] = mapped_column(
        ForeignKey("user_group.id", ondelete="SET NULL"), nullable=True, index=True
    )
