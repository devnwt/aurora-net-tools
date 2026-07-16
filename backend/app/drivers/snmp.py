"""Driver SNMP — wrapper sobre net-snmp (snmpget/snmpbulkwalk). Somente leitura (decisão §6)."""

import asyncio
import os
import shlex

from app.core.crypto import decrypt
from app.drivers.base import DriverError
from app.models import Credential, Device
from app.models.enums import SnmpVersion


def _base_args(device: Device, credential: Credential) -> list[str]:
    version = credential.snmp_version or SnmpVersion.v2c
    community = decrypt(credential.secret) if credential.secret else ""

    args: list[str] = ["-t", "3", "-r", "1"]  # timeout 3s, 1 retry — falha rápido
    mibdirs = os.getenv("MIBDIRS")
    if mibdirs:
        args += ["-M", mibdirs, "-m", "ALL"]

    if version == SnmpVersion.v3:
        # v3: usa username + protocolos/segredos da credencial (auth/priv).
        args += ["-v3", "-u", credential.username, "-l", "authPriv"]
        if credential.snmp_v3_auth_protocol:
            args += ["-a", credential.snmp_v3_auth_protocol, "-A", community]
        if credential.snmp_v3_priv_protocol and credential.snmp_v3_priv_secret:
            args += ["-x", credential.snmp_v3_priv_protocol, "-X", decrypt(credential.snmp_v3_priv_secret)]
    else:
        args += ["-v2c", "-c", community]

    return args


def _parse(stdout: str) -> list[dict]:
    """Parseia linhas `OID = TYPE: VALUE` do net-snmp."""
    records = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line or " = " not in line:
            continue
        oid, rest = line.split(" = ", 1)
        if ": " in rest:
            typ, value = rest.split(": ", 1)
        else:
            typ, value = "", rest
        records.append({"oid": oid.strip(), "type": typ.strip(), "value": value.strip()})
    return records


async def _execute(binary: str, device: Device, credential: Credential, oid: str) -> list[dict]:
    target = f"{device.ip}:{device.snmp_port}"
    args = [binary, *_base_args(device, credential), target, oid]
    try:
        proc = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        out, err = await asyncio.wait_for(proc.communicate(), timeout=30)
    except asyncio.TimeoutError as e:
        raise DriverError(f"SNMP timeout em {target} (oid {oid})") from e
    except FileNotFoundError as e:
        raise DriverError(f"binário {binary} não encontrado (net-snmp instalado?)") from e

    stdout = out.decode("utf-8", errors="replace")
    stderr = err.decode("utf-8", errors="replace").strip()
    if proc.returncode != 0 or (stderr and not stdout.strip()):
        raise DriverError(f"SNMP falhou ({binary}) em {target}: {stderr or 'sem resposta'}")

    records = _parse(stdout)
    if not records and stderr:
        raise DriverError(f"SNMP em {target}: {stderr}")
    return records


async def snmp_get(device: Device, credential: Credential, oid: str) -> list[dict]:
    return await _execute("snmpget", device, credential, oid)


async def snmp_walk(device: Device, credential: Credential, oid: str) -> list[dict]:
    return await _execute("snmpbulkwalk", device, credential, oid)


def command_preview(device: Device, oid: str, walk: bool) -> str:
    """Representação do comando para auditoria (sem segredos)."""
    binary = "snmpbulkwalk" if walk else "snmpget"
    return shlex.join([binary, f"{device.ip}:{device.snmp_port}", oid])
