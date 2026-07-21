"""Endpoints de leitura ao vivo de RouterOS (MikroTik) — sob demanda via SSH/Telnet.

Reusa o `runner` (classifier read-only + lock + auditoria). Apenas comandos
`...print` (leitura). Montado sob `/devices/{id}/mikrotik/*`.
"""

import ipaddress
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.tenancy import owned
from app.core.db import get_session
from app.drivers import routeros
from app.drivers import ssh as ssh_driver
from app.drivers.base import DriverError
from app.models import Device, User
from app.models.enums import DeviceType, Protocol
from app.services import runner
from app.services.connlock import TargetBusy, target_lock
from app.services.credentials import CredentialNotFound, resolve_credential

router = APIRouter(prefix="/devices", tags=["mikrotik"], dependencies=[Depends(get_current_user)])


async def _get_routeros(session: AsyncSession, device_id: int, user: User) -> Device:
    d = (await session.execute(select(Device).where(Device.id == device_id))).scalar_one_or_none()
    owned(d, user)  # 404 se fora da ORG
    if d.device_type != DeviceType.routeros:
        raise HTTPException(400, "operação disponível apenas para RouterOS")
    return d


def _protocol(device: Device) -> Protocol:
    if device.ssh_enabled:
        return Protocol.ssh
    if device.telnet_enabled:
        return Protocol.telnet
    raise HTTPException(400, "device sem SSH/Telnet habilitado")


async def _read(session: AsyncSession, user: User, device: Device, command: str) -> str:
    proto = _protocol(device)
    try:
        return await runner.exec_command(
            session, actor=f"user:{user.id}", device=device, protocol=proto, command=command
        )
    except CredentialNotFound as e:
        raise HTTPException(400, str(e))
    except TargetBusy as e:
        raise HTTPException(409, str(e))
    except DriverError as e:
        raise HTTPException(502, str(e))


# === Overview (header + interfaces + services numa única sessão SSH) ===


@router.get("/{device_id}/mikrotik/overview")
async def overview(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    proto = _protocol(device)
    cmds = [routeros.CMD_RESOURCE_BOARD, routeros.CMD_HEALTH, routeros.CMD_INTERFACES, routeros.CMD_SERVICES]
    try:
        out = await runner.exec_many(session, actor=f"user:{user.id}", device=device, protocol=proto, commands=cmds)
    except CredentialNotFound as e:
        raise HTTPException(400, str(e))
    except TargetBusy as e:
        raise HTTPException(409, str(e))
    except DriverError as e:
        raise HTTPException(502, str(e))
    props = routeros.parse_props(out[0])
    temperature = routeros.health_temperature(out[1])
    # Só serviços estáticos configurados (descarta dinâmicos: resolver/dhcp/conexões — flag D).
    services = [r for r in routeros.parse_terse(out[3]) if "D" not in (r.get("flags") or "")]
    return {
        "ok": True,
        "device": device.name,
        "summary": routeros.summarize_system(props, temperature),
        "interfaces": routeros.parse_terse(out[2]),
        "services": services,
        "raw": props,
    }


@router.get("/{device_id}/mikrotik/system")
async def system(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    props = routeros.parse_props(await _read(session, user, device, routeros.CMD_RESOURCE_BOARD))
    temperature = None
    try:
        temperature = routeros.health_temperature(await _read(session, user, device, routeros.CMD_HEALTH))
    except HTTPException:
        pass  # /system health pode não existir em alguns modelos
    return {"ok": True, "device": device.name, "summary": routeros.summarize_system(props, temperature), "raw": props}


# === Tabelas (terse) ===


async def _table(device_id, command, key, session, user, static_only: bool = False):
    device = await _get_routeros(session, device_id, user)
    data = routeros.parse_terse(await _read(session, user, device, command))
    if static_only:  # descarta regras dinâmicas (flag D)
        data = [r for r in data if "D" not in (r.get("flags") or "")]
    return {"ok": True, "device": device.name, key: data}


@router.get("/{device_id}/mikrotik/interfaces")
async def interfaces(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return await _table(device_id, routeros.CMD_INTERFACES, "interfaces", session, user)


@router.get("/{device_id}/mikrotik/netinfo")
async def netinfo(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    """Interfaces + detecção de WAN — base para os selects e badges de configuração."""
    device = await _get_routeros(session, device_id, user)
    proto = _protocol(device)
    cmds = [routeros.CMD_INTERFACES, routeros.CMD_ROUTES, routeros.CMD_IP_ADDRESSES, routeros.CMD_DHCP_CLIENT]
    try:
        out = await runner.exec_many(session, actor=f"user:{user.id}", device=device, protocol=proto, commands=cmds)
    except CredentialNotFound as e:
        raise HTTPException(400, str(e))
    except TargetBusy as e:
        raise HTTPException(409, str(e))
    except DriverError as e:
        raise HTTPException(502, str(e))
    ifaces = routeros.parse_terse(out[0])
    wan = routeros.wan_interfaces(routeros.parse_terse(out[1]), routeros.parse_terse(out[2]), routeros.parse_terse(out[3]))
    return {"ok": True, "device": device.name, "interfaces": ifaces, "wan": wan}


@router.get("/{device_id}/mikrotik/firewall/filter")
async def firewall_filter(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return await _table(device_id, routeros.CMD_FW_FILTER, "rules", session, user, static_only=True)


@router.get("/{device_id}/mikrotik/firewall/nat")
async def firewall_nat(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return await _table(device_id, routeros.CMD_FW_NAT, "rules", session, user, static_only=True)


@router.get("/{device_id}/mikrotik/dhcp/servers")
async def dhcp_servers(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return await _table(device_id, routeros.CMD_DHCP_SERVERS, "servers", session, user)


@router.get("/{device_id}/mikrotik/dhcp/leases")
async def dhcp_leases(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return await _table(device_id, routeros.CMD_DHCP_LEASES, "leases", session, user)


@router.get("/{device_id}/mikrotik/routes")
async def routes(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return await _table(device_id, routeros.CMD_ROUTES, "routes", session, user)


@router.get("/{device_id}/mikrotik/ip/services")
async def ip_services(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    """Serviços IP (/ip service) — www, ssh, telnet, ftp, api, winbox… (só estáticos)."""
    return await _table(device_id, routeros.CMD_SERVICES, "services", session, user, static_only=True)


@router.get("/{device_id}/mikrotik/neighbors")
async def neighbors(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return await _table(device_id, routeros.CMD_NEIGHBORS, "neighbors", session, user)


@router.get("/{device_id}/mikrotik/logs")
async def logs(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    data = routeros.parse_logs(await _read(session, user, device, routeros.CMD_LOGS))
    return {"ok": True, "device": device.name, "logs": data[-500:]}  # últimas 500 entradas


# === Security (hardening checks — leitura) ===


def _off(r: dict) -> bool:
    return r.get("disabled") == "true" or "X" in (r.get("flags") or "")


@router.get("/{device_id}/mikrotik/security")
async def security(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    proto = _protocol(device)
    cmds = [routeros.CMD_SERVICES, routeros.CMD_USERS, routeros.CMD_FW_FILTER, routeros.CMD_RESOURCE_BOARD]
    try:
        out = await runner.exec_many(session, actor=f"user:{user.id}", device=device, protocol=proto, commands=cmds)
    except CredentialNotFound as e:
        raise HTTPException(400, str(e))
    except TargetBusy as e:
        raise HTTPException(409, str(e))
    except DriverError as e:
        raise HTTPException(502, str(e))

    services = [s for s in routeros.parse_terse(out[0]) if "D" not in (s.get("flags") or "")]
    users = routeros.parse_terse(out[1])
    fw = routeros.parse_terse(out[2])
    props = routeros.parse_props(out[3])

    findings: list[dict] = []

    def add(sev: str, title: str, detail: str) -> None:
        findings.append({"severity": sev, "title": title, "detail": detail})

    # 1) serviços inseguros habilitados
    insecure = [s for s in services if s.get("name") in ("telnet", "ftp", "www", "api") and not _off(s)]
    if insecure:
        add("fail", "Serviços inseguros habilitados", ", ".join(f"{s['name']}:{s.get('port', '')}" for s in insecure))
    else:
        add("ok", "Serviços inseguros desabilitados", "telnet, ftp, www e api-http desativados")

    # 2) SSH em porta padrão
    ssh = next((s for s in services if s.get("name") == "ssh" and not _off(s)), None)
    if ssh:
        if ssh.get("port") == "22":
            add("warn", "SSH na porta padrão (22)", "Considere usar uma porta não-padrão para o SSH")
        else:
            add("ok", "SSH em porta não-padrão", f"porta {ssh.get('port')}")

    # 3) usuário admin padrão
    if [u for u in users if u.get("name") == "admin" and not _off(u)]:
        add("warn", "Usuário 'admin' padrão ativo", "Renomeie ou desative o usuário admin padrão")
    else:
        add("ok", "Sem usuário 'admin' padrão ativo", "")

    # 4) usuários com acesso total
    full = [u for u in users if u.get("group") == "full"]
    add("warn" if len(full) > 1 else "ok", "Usuários com acesso total (full)", f"{len(full)} usuário(s) no grupo full")

    # 5) firewall protege a chain input
    if any(r.get("chain") == "input" and r.get("action") in ("drop", "reject") for r in fw):
        add("ok", "Firewall protege a chain input", "há regra de drop/reject em input")
    else:
        add("fail", "Chain input sem drop/reject", "o roteador pode estar exposto — adicione uma política de bloqueio em input")

    # 6) firmware do RouterBOARD
    cur, upg = props.get("current-firmware"), props.get("upgrade-firmware")
    if cur and upg and cur != upg:
        add("warn", "Firmware do RouterBOARD desatualizado", f"{cur} → {upg} (upgrade pendente)")
    elif cur:
        add("ok", "Firmware do RouterBOARD atualizado", cur)

    summary = {sev: sum(1 for f in findings if f["severity"] == sev) for sev in ("ok", "warn", "fail")}
    return {"ok": True, "device": device.name, "findings": findings, "summary": summary}


@router.get("/{device_id}/mikrotik/traffic")
async def traffic(
    device_id: int,
    iface: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Taxa instantânea rx/tx de uma interface (monitor-traffic). Leitura silenciosa (alta freq.)."""
    device = await _get_routeros(session, device_id, user)
    if not re.fullmatch(r"[A-Za-z0-9._-]+", iface):
        raise HTTPException(400, "nome de interface inválido")
    proto = _protocol(device)
    try:
        cred = await resolve_credential(session, device, proto)
    except CredentialNotFound as e:
        raise HTTPException(400, str(e))
    cmd = f"/interface monitor-traffic {iface} once without-paging"
    try:
        async with target_lock("device", device.id):
            out = await ssh_driver.run(device, cred, cmd, proto)
    except TargetBusy as e:
        raise HTTPException(409, str(e))
    except DriverError as e:
        raise HTTPException(502, str(e))
    props = routeros.parse_props(out)
    return {
        "ok": True,
        "iface": iface,
        "rx_bps": routeros.parse_bps(props.get("rx-bits-per-second")),
        "tx_bps": routeros.parse_bps(props.get("tx-bits-per-second")),
    }


async def _monitor_once(session: AsyncSession, device: Device, cmd: str) -> dict:
    """Roda um `monitor ... once` silencioso (lock por device) e devolve props."""
    proto = _protocol(device)
    try:
        cred = await resolve_credential(session, device, proto)
    except CredentialNotFound as e:
        raise HTTPException(400, str(e))
    try:
        async with target_lock("device", device.id):
            out = await ssh_driver.run(device, cred, cmd, proto)
    except TargetBusy as e:
        raise HTTPException(409, str(e))
    except DriverError as e:
        raise HTTPException(502, str(e))
    return routeros.parse_props(out)


_OPTIC_KEYS = (
    "status", "rate", "sfp-module-present", "sfp-temperature", "sfp-supply-voltage",
    "sfp-tx-power", "sfp-rx-power", "sfp-tx-bias-current", "sfp-wavelength",
    "sfp-vendor-name", "sfp-vendor-part-number", "sfp-type",
)


@router.get("/{device_id}/mikrotik/optics")
async def optics(device_id: int, iface: str, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    """Diagnóstico óptico de uma interface SFP (`/interface ethernet monitor` — sfp-rx/tx-power…)."""
    device = await _get_routeros(session, device_id, user)
    if not re.fullmatch(r"[A-Za-z0-9._-]+", iface):
        raise HTTPException(400, "nome de interface inválido")
    props = await _monitor_once(session, device, f"/interface ethernet monitor {iface} once without-paging")
    optical = props.get("sfp-module-present") in ("yes", "true") or props.get("sfp-rx-power") is not None
    data = {k: props.get(k) for k in _OPTIC_KEYS if props.get(k) is not None}
    return {"ok": True, "iface": iface, "optical": bool(optical), "data": data}


@router.get("/{device_id}/mikrotik/poe")
async def poe(device_id: int, iface: str, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    """Diagnóstico PoE-out de uma interface (`/interface ethernet poe monitor`)."""
    device = await _get_routeros(session, device_id, user)
    if not re.fullmatch(r"[A-Za-z0-9._-]+", iface):
        raise HTTPException(400, "nome de interface inválido")
    try:
        props = await _monitor_once(session, device, f"/interface ethernet poe monitor {iface} once without-paging")
    except HTTPException:
        props = {}
    status = props.get("poe-out-status")
    data = {k: props.get(k) for k in ("poe-out-status", "poe-out-voltage", "poe-out-current", "poe-out-power") if props.get(k) is not None}
    return {"ok": True, "iface": iface, "poe": bool(status and status != "disabled"), "data": data}


@router.get("/{device_id}/mikrotik/protocols")
async def protocols(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    """Detecta OSPF / MPLS / VPLS ativos e resume (instâncias, vizinhos, túneis)."""
    device = await _get_routeros(session, device_id, user)
    proto = _protocol(device)
    cmds = [
        "/routing ospf instance print terse without-paging",
        "/routing ospf neighbor print terse without-paging",
        "/mpls interface print terse without-paging",
        "/mpls ldp neighbor print terse without-paging",
        "/interface vpls print terse without-paging",
    ]
    try:
        out = await runner.exec_many(session, actor=f"user:{user.id}", device=device, protocol=proto, commands=cmds)
    except CredentialNotFound as e:
        raise HTTPException(400, str(e))
    except TargetBusy as e:
        raise HTTPException(409, str(e))
    except DriverError as e:
        raise HTTPException(502, str(e))
    ospf_inst = routeros.parse_terse(out[0])
    ospf_nb = routeros.parse_terse(out[1])
    # Descarta a entrada default "all" (existe em toda RB, mesmo sem MPLS em uso).
    mpls_if = [i for i in routeros.parse_terse(out[2]) if i.get("interface") not in (None, "all")]
    ldp_nb = routeros.parse_terse(out[3])
    vpls = [v for v in routeros.parse_terse(out[4]) if "D" not in (v.get("flags") or "")]
    return {
        "ok": True,
        "device": device.name,
        # OSPF/MPLS "ativo" = tem adjacência de fato (não só configuração default).
        "ospf": {"active": len(ospf_nb) > 0, "instances": ospf_inst, "neighbors": ospf_nb},
        "mpls": {"active": len(ldp_nb) > 0, "interfaces": mpls_if, "ldp_neighbors": ldp_nb},
        "vpls": {"active": len(vpls) > 0, "tunnels": vpls},
    }


# === Gestão (escrita controlada): IP e DHCP ===============================
# Comandos são montados no servidor a partir de campos VALIDADOS (sem comando
# livre do usuário). Cada ação é auditada como `write`.

_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")
_MAC_RE = re.compile(r"^[0-9A-Fa-f]{2}([:-][0-9A-Fa-f]{2}){5}$")
_LEASE_RE = re.compile(r"^[0-9]+[smhdwSMHDW]?$")


def _bad(msg: str):
    raise HTTPException(400, msg)


def _v_cidr(v: str) -> str:
    try:
        ipaddress.ip_interface(v)
    except ValueError:
        _bad(f"endereço CIDR inválido: {v}")
    return v


def _v_ip(v: str) -> str:
    try:
        ipaddress.ip_address(v)
    except ValueError:
        _bad(f"IP inválido: {v}")
    return v


def _v_name(v: str, label: str) -> str:
    if not _NAME_RE.match(v or ""):
        _bad(f"{label} inválido: {v!r}")
    return v


def _v_mac(v: str) -> str:
    if not _MAC_RE.match(v or ""):
        _bad(f"MAC inválido: {v}")
    return v


def _comment(v: str | None) -> str:
    """Sufixo comment="..." validado (sem aspas/;/quebras que quebrem o comando)."""
    if not v:
        return ""
    if any(c in v for c in '";\r\n'):
        _bad("comentário contém caracteres inválidos")
    return f' comment="{v}"'


def _v_ipish(v: str, label: str) -> str:
    """Endereço/rede/range: IPv4/IPv6/CIDR/range (sem espaços/aspas)."""
    if not re.fullmatch(r"[0-9A-Fa-f:./-]+", v or ""):
        _bad(f"{label} inválido: {v!r}")
    return v


def _v_port(v: str) -> str:
    if not re.fullmatch(r"[0-9,\-]+", v or ""):
        _bad(f"porta inválida: {v!r}")
    return v


def _v_gw(v: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9._:/-]+", v or ""):
        _bad(f"gateway inválido: {v!r}")
    return v


def _v_num(v: int) -> str:
    if not isinstance(v, int) or v < 0:
        _bad(f"número inválido: {v!r}")
    return str(v)


def _kv(field: str, value, validator) -> str:
    """Monta ' field=valor' se `value` presente, validando; senão string vazia."""
    if value is None or value == "":
        return ""
    return f" {field}={validator(value)}"


async def _write(session: AsyncSession, user: User, device: Device, command: str) -> str:
    proto = _protocol(device)
    try:
        return await runner.exec_write(
            session, actor=f"user:{user.id}", device=device, protocol=proto, command=command
        )
    except CredentialNotFound as e:
        raise HTTPException(400, str(e))
    except TargetBusy as e:
        raise HTTPException(409, str(e))
    except DriverError as e:
        raise HTTPException(502, str(e))


# --- IP addresses ---


@router.get("/{device_id}/mikrotik/ip/addresses")
async def ip_addresses(device_id: int, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    return await _table(device_id, routeros.CMD_IP_ADDRESSES, "addresses", session, user)


class IpAddressBody(BaseModel):
    address: str
    interface: str
    comment: str | None = None


@router.post("/{device_id}/mikrotik/ip/addresses/add")
async def ip_address_add(device_id: int, body: IpAddressBody, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    cmd = f"/ip address add address={_v_cidr(body.address)} interface={_v_name(body.interface, 'interface')}{_comment(body.comment)}"
    return {"ok": True, "output": (await _write(session, user, device, cmd)).strip()}


class IpToggleBody(BaseModel):
    address: str
    interface: str
    disable: bool


@router.post("/{device_id}/mikrotik/ip/addresses/toggle")
async def ip_address_toggle(device_id: int, body: IpToggleBody, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    verb = "disable" if body.disable else "enable"
    cmd = f'/ip address {verb} [find where address="{_v_cidr(body.address)}" interface="{_v_name(body.interface, "interface")}"]'
    return {"ok": True, "output": (await _write(session, user, device, cmd)).strip()}


class IpRemoveBody(BaseModel):
    address: str
    interface: str


@router.post("/{device_id}/mikrotik/ip/addresses/remove")
async def ip_address_remove(device_id: int, body: IpRemoveBody, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    cmd = f'/ip address remove [find where address="{_v_cidr(body.address)}" interface="{_v_name(body.interface, "interface")}"]'
    return {"ok": True, "output": (await _write(session, user, device, cmd)).strip()}


# --- DHCP servers ---


class DhcpServerBody(BaseModel):
    name: str
    interface: str
    address_pool: str | None = None
    lease_time: str | None = None


@router.post("/{device_id}/mikrotik/dhcp/servers/add")
async def dhcp_server_add(device_id: int, body: DhcpServerBody, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    cmd = f"/ip dhcp-server add name={_v_name(body.name, 'name')} interface={_v_name(body.interface, 'interface')}"
    if body.address_pool:
        cmd += f" address-pool={_v_name(body.address_pool, 'address-pool')}"
    if body.lease_time:
        if not _LEASE_RE.match(body.lease_time):
            _bad(f"lease-time inválido: {body.lease_time}")
        cmd += f" lease-time={body.lease_time}"
    return {"ok": True, "output": (await _write(session, user, device, cmd)).strip()}


class DhcpServerToggle(BaseModel):
    name: str
    disable: bool


@router.post("/{device_id}/mikrotik/dhcp/servers/toggle")
async def dhcp_server_toggle(device_id: int, body: DhcpServerToggle, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    verb = "disable" if body.disable else "enable"
    cmd = f'/ip dhcp-server {verb} [find where name="{_v_name(body.name, "name")}"]'
    return {"ok": True, "output": (await _write(session, user, device, cmd)).strip()}


class DhcpServerRemove(BaseModel):
    name: str


@router.post("/{device_id}/mikrotik/dhcp/servers/remove")
async def dhcp_server_remove(device_id: int, body: DhcpServerRemove, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    cmd = f'/ip dhcp-server remove [find where name="{_v_name(body.name, "name")}"]'
    return {"ok": True, "output": (await _write(session, user, device, cmd)).strip()}


# --- DHCP leases ---


class LeaseAddBody(BaseModel):
    address: str
    mac_address: str
    server: str | None = None
    comment: str | None = None


@router.post("/{device_id}/mikrotik/dhcp/leases/add")
async def lease_add(device_id: int, body: LeaseAddBody, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    cmd = f"/ip dhcp-server lease add address={_v_ip(body.address)} mac-address={_v_mac(body.mac_address)}"
    if body.server:
        cmd += f" server={_v_name(body.server, 'server')}"
    cmd += _comment(body.comment)
    return {"ok": True, "output": (await _write(session, user, device, cmd)).strip()}


class LeaseAddrBody(BaseModel):
    address: str


@router.post("/{device_id}/mikrotik/dhcp/leases/make-static")
async def lease_make_static(device_id: int, body: LeaseAddrBody, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    cmd = f'/ip dhcp-server lease make-static [find where address="{_v_ip(body.address)}"]'
    return {"ok": True, "output": (await _write(session, user, device, cmd)).strip()}


@router.post("/{device_id}/mikrotik/dhcp/leases/remove")
async def lease_remove(device_id: int, body: LeaseAddrBody, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    cmd = f'/ip dhcp-server lease remove [find where address="{_v_ip(body.address)}"]'
    return {"ok": True, "output": (await _write(session, user, device, cmd)).strip()}


# --- Firewall (filter / nat) ---


class FilterAddBody(BaseModel):
    chain: str
    action: str
    protocol: str | None = None
    src_address: str | None = None
    dst_address: str | None = None
    dst_port: str | None = None
    in_interface: str | None = None
    out_interface: str | None = None
    comment: str | None = None


class NatAddBody(BaseModel):
    chain: str
    action: str
    protocol: str | None = None
    src_address: str | None = None
    dst_address: str | None = None
    to_addresses: str | None = None
    to_ports: str | None = None
    out_interface: str | None = None
    comment: str | None = None


class NumberToggle(BaseModel):
    number: int
    disable: bool


class NumberBody(BaseModel):
    number: int


@router.post("/{device_id}/mikrotik/firewall/filter/add")
async def fw_filter_add(device_id: int, body: FilterAddBody, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    cmd = f"/ip firewall filter add chain={_v_name(body.chain, 'chain')} action={_v_name(body.action, 'action')}"
    cmd += _kv("protocol", body.protocol, lambda v: _v_name(v, "protocol"))
    cmd += _kv("src-address", body.src_address, lambda v: _v_ipish(v, "src-address"))
    cmd += _kv("dst-address", body.dst_address, lambda v: _v_ipish(v, "dst-address"))
    cmd += _kv("dst-port", body.dst_port, _v_port)
    cmd += _kv("in-interface", body.in_interface, lambda v: _v_name(v, "in-interface"))
    cmd += _kv("out-interface", body.out_interface, lambda v: _v_name(v, "out-interface"))
    cmd += _comment(body.comment)
    return {"ok": True, "output": (await _write(session, user, device, cmd)).strip()}


@router.post("/{device_id}/mikrotik/firewall/nat/add")
async def fw_nat_add(device_id: int, body: NatAddBody, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    cmd = f"/ip firewall nat add chain={_v_name(body.chain, 'chain')} action={_v_name(body.action, 'action')}"
    cmd += _kv("protocol", body.protocol, lambda v: _v_name(v, "protocol"))
    cmd += _kv("src-address", body.src_address, lambda v: _v_ipish(v, "src-address"))
    cmd += _kv("dst-address", body.dst_address, lambda v: _v_ipish(v, "dst-address"))
    cmd += _kv("to-addresses", body.to_addresses, lambda v: _v_ipish(v, "to-addresses"))
    cmd += _kv("to-ports", body.to_ports, _v_port)
    cmd += _kv("out-interface", body.out_interface, lambda v: _v_name(v, "out-interface"))
    cmd += _comment(body.comment)
    return {"ok": True, "output": (await _write(session, user, device, cmd)).strip()}


def _fw_kind(kind: str) -> str:
    if kind not in ("filter", "nat"):
        _bad("firewall inválido")
    return kind


@router.post("/{device_id}/mikrotik/firewall/{kind}/toggle")
async def fw_toggle(device_id: int, kind: str, body: NumberToggle, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    verb = "disable" if body.disable else "enable"
    cmd = f"/ip firewall {_fw_kind(kind)} {verb} numbers={_v_num(body.number)}"
    return {"ok": True, "output": (await _write(session, user, device, cmd)).strip()}


@router.post("/{device_id}/mikrotik/firewall/{kind}/remove")
async def fw_remove(device_id: int, kind: str, body: NumberBody, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    cmd = f"/ip firewall {_fw_kind(kind)} remove numbers={_v_num(body.number)}"
    return {"ok": True, "output": (await _write(session, user, device, cmd)).strip()}


# --- Rotas estáticas ---


class RouteAddBody(BaseModel):
    dst_address: str
    gateway: str
    distance: str | None = None
    comment: str | None = None


class RouteRemoveBody(BaseModel):
    dst_address: str
    gateway: str


@router.post("/{device_id}/mikrotik/routes/add")
async def route_add(device_id: int, body: RouteAddBody, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    cmd = f"/ip route add dst-address={_v_ipish(body.dst_address, 'dst-address')} gateway={_v_gw(body.gateway)}"
    if body.distance:
        if not re.fullmatch(r"[0-9]+", body.distance):
            _bad(f"distance inválida: {body.distance}")
        cmd += f" distance={body.distance}"
    cmd += _comment(body.comment)
    return {"ok": True, "output": (await _write(session, user, device, cmd)).strip()}


@router.post("/{device_id}/mikrotik/routes/remove")
async def route_remove(device_id: int, body: RouteRemoveBody, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    cmd = f'/ip route remove [find where dst-address="{_v_ipish(body.dst_address, "dst-address")}" gateway="{_v_gw(body.gateway)}"]'
    return {"ok": True, "output": (await _write(session, user, device, cmd)).strip()}


# --- IP services (/ip service) ---


def _v_service_port(v: int) -> str:
    if not isinstance(v, int) or not (1 <= v <= 65535):
        _bad(f"porta inválida: {v!r}")
    return str(v)


class ServiceToggle(BaseModel):
    name: str
    disable: bool


@router.post("/{device_id}/mikrotik/ip/services/toggle")
async def service_toggle(device_id: int, body: ServiceToggle, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    verb = "disable" if body.disable else "enable"
    # Serviços built-in são endereçados pelo nome (evita casar entradas dinâmicas homônimas).
    cmd = f"/ip service {verb} {_v_name(body.name, 'name')}"
    return {"ok": True, "output": (await _write(session, user, device, cmd)).strip()}


class ServiceSetBody(BaseModel):
    name: str
    port: int | None = None
    address: str | None = None  # lista de redes permitidas (CIDR separados por vírgula) ou ""


@router.post("/{device_id}/mikrotik/ip/services/set")
async def service_set(device_id: int, body: ServiceSetBody, session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)):
    device = await _get_routeros(session, device_id, user)
    cmd = f"/ip service set {_v_name(body.name, 'name')}"
    if body.port is not None:
        cmd += f" port={_v_service_port(body.port)}"
    if body.address is not None:  # "" limpa a restrição (address="")
        addr = body.address.strip()
        if addr and not re.fullmatch(r"[0-9A-Fa-f:./,]+", addr):
            _bad(f"address inválido: {addr!r}")
        cmd += f' address="{addr}"'
    return {"ok": True, "output": (await _write(session, user, device, cmd)).strip()}
