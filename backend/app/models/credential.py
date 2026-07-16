from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.enums import CredentialKind, SnmpVersion
from app.models.mixins import TimestampMixin


class Credential(Base, TimestampMixin):
    """Perfil de credencial reutilizável (decisão §7).

    `secret` é armazenado cifrado (Fernet). Para SNMP v2c, `secret` é a
    community e `username` fica vazio.
    """

    __tablename__ = "credential"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[CredentialKind] = mapped_column(SAEnum(CredentialKind, name="credential_kind"))
    username: Mapped[str] = mapped_column(String(120), default="")
    secret: Mapped[str] = mapped_column(String(512), default="")  # cifrado

    # SNMP
    snmp_version: Mapped[SnmpVersion | None] = mapped_column(
        SAEnum(SnmpVersion, name="snmp_version"), nullable=True
    )
    snmp_v3_auth_protocol: Mapped[str | None] = mapped_column(String(32), nullable=True)
    snmp_v3_priv_protocol: Mapped[str | None] = mapped_column(String(32), nullable=True)
    snmp_v3_priv_secret: Mapped[str | None] = mapped_column(String(512), nullable=True)  # cifrado
