from pydantic import BaseModel, ConfigDict


class GroupBase(BaseModel):
    name: str
    location: str = ""
    description: str = ""
    latitude: float | None = None
    longitude: float | None = None
    default_ssh_credential_id: int | None = None
    default_telnet_credential_id: int | None = None
    default_snmp_credential_id: int | None = None
    default_api_credential_id: int | None = None


class GroupCreate(GroupBase):
    pass


class GroupUpdate(BaseModel):
    name: str | None = None
    location: str | None = None
    description: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    default_ssh_credential_id: int | None = None
    default_telnet_credential_id: int | None = None
    default_snmp_credential_id: int | None = None
    default_api_credential_id: int | None = None


class GroupOut(GroupBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
