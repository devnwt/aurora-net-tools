"""Catálogo curado de diagnósticos read-only por device_type (decisão §13).

Cada operação é exposta como botão na UI e como ferramenta no MCP. Tudo aqui é
leitura e passa pelo mesmo `runner` (classifier + auditoria).
"""

from dataclasses import dataclass

from app.models.enums import DeviceType, Protocol


@dataclass(frozen=True)
class CatalogOp:
    key: str
    label: str
    device_types: tuple[DeviceType, ...]
    protocol: Protocol
    command: str = ""  # para exec
    oid: str = ""      # para snmp
    walk: bool = False


CATALOG: list[CatalogOp] = [
    # RouterOS
    CatalogOp("ros_system", "Recursos do sistema", (DeviceType.routeros,), Protocol.ssh, "/system resource print"),
    CatalogOp("ros_interfaces", "Interfaces", (DeviceType.routeros,), Protocol.ssh, "/interface print"),
    CatalogOp("ros_routes", "Rotas", (DeviceType.routeros,), Protocol.ssh, "/ip route print"),
    CatalogOp("ros_identity", "Identidade", (DeviceType.routeros,), Protocol.ssh, "/system identity print"),
    # Cisco
    CatalogOp("cisco_version", "Versão", (DeviceType.cisco,), Protocol.ssh, "show version"),
    CatalogOp("cisco_interfaces", "Interfaces", (DeviceType.cisco,), Protocol.ssh, "show ip interface brief"),
    CatalogOp("cisco_routes", "Rotas", (DeviceType.cisco,), Protocol.ssh, "show ip route"),
    # Huawei
    CatalogOp("hw_version", "Versão", (DeviceType.huawei,), Protocol.ssh, "display version"),
    CatalogOp("hw_interfaces", "Interfaces", (DeviceType.huawei,), Protocol.ssh, "display interface brief"),
    CatalogOp("hw_routes", "Rotas", (DeviceType.huawei,), Protocol.ssh, "display ip routing-table"),
    # SNMP (qualquer device com SNMP) — system group
    CatalogOp(
        "snmp_system", "SNMP system (1.3.6.1.2.1.1)",
        (DeviceType.routeros, DeviceType.cisco, DeviceType.huawei),
        Protocol.snmp, oid="1.3.6.1.2.1.1", walk=True,
    ),
    CatalogOp(
        "snmp_uptime", "SNMP uptime",
        (DeviceType.routeros, DeviceType.cisco, DeviceType.huawei),
        Protocol.snmp, oid="1.3.6.1.2.1.1.3.0", walk=False,
    ),
]

_BY_KEY = {op.key: op for op in CATALOG}


def for_device_type(device_type: DeviceType) -> list[CatalogOp]:
    return [op for op in CATALOG if device_type in op.device_types]


def get_op(key: str) -> CatalogOp | None:
    return _BY_KEY.get(key)
