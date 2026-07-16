from pydantic import BaseModel, ConfigDict

from app.core.crypto import SECRET_MASK
from app.models.enums import CredentialKind, SnmpVersion


class CredentialBase(BaseModel):
    name: str
    kind: CredentialKind
    username: str = ""
    snmp_version: SnmpVersion | None = None
    snmp_v3_auth_protocol: str | None = None
    snmp_v3_priv_protocol: str | None = None


class CredentialCreate(CredentialBase):
    secret: str = ""
    snmp_v3_priv_secret: str | None = None


class CredentialUpdate(BaseModel):
    name: str | None = None
    username: str | None = None
    secret: str | None = None  # se enviado, re-cifra
    snmp_version: SnmpVersion | None = None
    snmp_v3_auth_protocol: str | None = None
    snmp_v3_priv_protocol: str | None = None
    snmp_v3_priv_secret: str | None = None


class CredentialOut(CredentialBase):
    """Saída — segredos sempre mascarados (decisão §9)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    secret: str = SECRET_MASK

    @classmethod
    def from_model(cls, m) -> "CredentialOut":
        return cls(
            id=m.id,
            name=m.name,
            kind=m.kind,
            username=m.username,
            snmp_version=m.snmp_version,
            snmp_v3_auth_protocol=m.snmp_v3_auth_protocol,
            snmp_v3_priv_protocol=m.snmp_v3_priv_protocol,
            secret=SECRET_MASK if m.secret else "",
        )
