import enum


class DeviceType(str, enum.Enum):
    routeros = "routeros"
    huawei = "huawei"
    cisco = "cisco"


class ConnectionMode(str, enum.Enum):
    direct = "direct"
    controller = "controller"


class ControllerKind(str, enum.Enum):
    fiberhome_unm2000 = "fiberhome_unm2000"


class CredentialKind(str, enum.Enum):
    ssh = "ssh"
    telnet = "telnet"
    snmp = "snmp"
    api = "api"
    tl1 = "tl1"


class SnmpVersion(str, enum.Enum):
    v2c = "v2c"
    v3 = "v3"


class Protocol(str, enum.Enum):
    ssh = "ssh"
    telnet = "telnet"
    snmp = "snmp"
    tl1 = "tl1"


class Classification(str, enum.Enum):
    read = "read"
    write = "write"


class TargetKind(str, enum.Enum):
    device = "device"
    controller = "controller"
