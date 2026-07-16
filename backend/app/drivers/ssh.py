"""Driver SSH/Telnet via netmiko (decisão: netmiko primário)."""

import asyncio

from app.core.crypto import decrypt
from app.drivers.base import DriverError
from app.models import Credential, Device
from app.models.enums import DeviceType, Protocol

# Mapeia device_type -> netmiko device_type (base SSH).
_NETMIKO_SSH = {
    DeviceType.routeros: "mikrotik_routeros",
    DeviceType.cisco: "cisco_ios",
    DeviceType.huawei: "huawei",
}
# Variantes Telnet do netmiko.
_NETMIKO_TELNET = {
    DeviceType.routeros: "mikrotik_routeros_telnet",
    DeviceType.cisco: "cisco_ios_telnet",
    DeviceType.huawei: "huawei_telnet",
}


def _connect(netmiko_type, host, port, username, password):
    from netmiko import ConnectHandler  # import tardio (dependência pesada)

    return ConnectHandler(
        device_type=netmiko_type,
        host=host,
        port=port,
        username=username,
        password=password,
        fast_cli=False,
        conn_timeout=15,
    )


def _run_sync(netmiko_type, host, port, username, password, command: str) -> str:
    conn = _connect(netmiko_type, host, port, username, password)
    try:
        return conn.send_command(command, read_timeout=30)
    finally:
        conn.disconnect()


def _run_many_sync(netmiko_type, host, port, username, password, commands: list[str]) -> list[str]:
    """Roda vários comandos na MESMA sessão (1 login) — evita N conexões e colisão de lock."""
    conn = _connect(netmiko_type, host, port, username, password)
    try:
        return [conn.send_command(c, read_timeout=30) for c in commands]
    finally:
        conn.disconnect()


def _resolve(device: Device, protocol: Protocol) -> tuple[str, int]:
    if protocol == Protocol.telnet:
        netmiko_type = _NETMIKO_TELNET.get(device.device_type)
        port = device.telnet_port
    else:
        netmiko_type = _NETMIKO_SSH.get(device.device_type)
        port = device.ssh_port
    if not netmiko_type:
        raise DriverError(f"device_type {device.device_type} não suportado em {protocol.value}")
    return netmiko_type, port


async def run(device: Device, credential: Credential, command: str, protocol: Protocol) -> str:
    netmiko_type, port = _resolve(device, protocol)
    password = decrypt(credential.secret) if credential.secret else ""
    try:
        return await asyncio.to_thread(
            _run_sync, netmiko_type, device.ip, port, credential.username, password, command
        )
    except Exception as e:  # netmiko levanta várias exceções específicas
        raise DriverError(f"{protocol.value} falhou em {device.ip}: {e}") from e


async def run_many(device: Device, credential: Credential, commands: list[str], protocol: Protocol) -> list[str]:
    netmiko_type, port = _resolve(device, protocol)
    password = decrypt(credential.secret) if credential.secret else ""
    try:
        return await asyncio.to_thread(
            _run_many_sync, netmiko_type, device.ip, port, credential.username, password, commands
        )
    except Exception as e:
        raise DriverError(f"{protocol.value} falhou em {device.ip}: {e}") from e
