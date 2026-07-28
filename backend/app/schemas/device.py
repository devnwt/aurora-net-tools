from pydantic import BaseModel, ConfigDict

from app.models.enums import ConnectionMode, DeviceType


class DeviceBase(BaseModel):
    name: str
    ip: str
    device_type: DeviceType
    connection_mode: ConnectionMode = ConnectionMode.direct
    group_id: int | None = None
    rack_id: int | None = None

    ssh_enabled: bool = False
    ssh_port: int = 22
    ssh_credential_id: int | None = None

    telnet_enabled: bool = False
    telnet_port: int = 23
    telnet_credential_id: int | None = None

    snmp_enabled: bool = False
    snmp_port: int = 161
    snmp_credential_id: int | None = None

    api_enabled: bool = False
    api_base_url: str = ""
    api_credential_id: int | None = None

    notes: str = ""

    latitude: float | None = None
    longitude: float | None = None


class DeviceCreate(DeviceBase):
    pass


class DeviceUpdate(BaseModel):
    name: str | None = None
    ip: str | None = None
    device_type: DeviceType | None = None
    group_id: int | None = None
    rack_id: int | None = None
    ssh_enabled: bool | None = None
    ssh_port: int | None = None
    ssh_credential_id: int | None = None
    telnet_enabled: bool | None = None
    telnet_port: int | None = None
    telnet_credential_id: int | None = None
    snmp_enabled: bool | None = None
    snmp_port: int | None = None
    snmp_credential_id: int | None = None
    api_enabled: bool | None = None
    api_base_url: str | None = None
    api_credential_id: int | None = None
    notes: str | None = None
    latitude: float | None = None
    longitude: float | None = None


class DeviceOut(DeviceBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    # Tenant dono do device. Para o Master (que enxerga todas as ORGs) o frontend
    # usa isto para sinalizar/agrupar por empresa; para os demais é sempre a própria.
    org_id: int | None = None
