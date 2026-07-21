"""MCP server built-in (FastMCP), montado em /mcp (decisão §5/§6).

Reaproveita o mesmo `runner` da API REST — logo, a política read-only (classifier)
e a auditoria valem igualmente para a IA. Padrão de retorno `_result` herdado do
fiberhome_mcp.py.
"""

from typing import Any

from mcp.server.fastmcp import FastMCP
from sqlalchemy import or_, select

from app.api.tenancy import scope as tscope
from app.core.config import get_settings
from app.core.db import SessionLocal, engine
from app.drivers import fiberhome
from app.drivers.base import DriverError, WriteBlocked
from app.mcp.context import get_principal
from app.models import Controller, Credential, Device, DeviceGroup, User
from app.models.enums import DeviceType, Protocol
from app.services import runner
from app.services.credentials import CredentialNotFound

settings = get_settings()

mcp = FastMCP("aurora-nettools", streamable_http_path="/")

ACTOR = "mcp"


def _result(ok: bool, data: Any = None, error: str | None = None, **meta: Any) -> dict:
    payload = {"ok": ok, "data": data, "error": error}
    payload.update(meta)
    return payload


def _p() -> User:
    """Principal da sessão MCP; sem chave → sentinela sem acesso (org_id=-1)."""
    return get_principal() or User(id=0, username="anon", role="operator", org_id=-1)


def _owns(obj, p: User) -> bool:
    return obj is not None and (p.role == "master" or getattr(obj, "org_id", None) == p.org_id)


async def _get_device(session, device_id: int) -> Device | None:
    d = (await session.execute(select(Device).where(Device.id == device_id))).scalar_one_or_none()
    return d if _owns(d, _p()) else None


@mcp.tool()
async def health() -> dict:
    """Verifica saúde do serviço e do banco."""
    try:
        async with engine.connect() as conn:
            from sqlalchemy import text

            await conn.execute(text("SELECT 1"))
        return _result(True, {"status": "ok"})
    except Exception as e:
        return _result(False, None, str(e))


@mcp.tool()
async def listar_grupos() -> dict:
    """Lista os grupos/sites de equipamentos (da ORG)."""
    async with SessionLocal() as session:
        rows = (await session.execute(tscope(select(DeviceGroup), DeviceGroup, _p()).order_by(DeviceGroup.name))).scalars().all()
        return _result(True, [{"id": g.id, "name": g.name} for g in rows], count=len(rows))


@mcp.tool()
async def listar_controllers() -> dict:
    """Lista as controladoras/EMS da ORG (ex.: UNM2000 Fiberhome)."""
    async with SessionLocal() as session:
        rows = (await session.execute(tscope(select(Controller), Controller, _p()).order_by(Controller.name))).scalars().all()
        return _result(
            True,
            [{"id": c.id, "name": c.name, "kind": c.kind.value, "host": c.host} for c in rows],
            count=len(rows),
        )


@mcp.tool()
async def listar_devices(group_id: int | None = None, device_type: str | None = None) -> dict:
    """Lista equipamentos de acesso direto da ORG, com filtro opcional por grupo e tipo."""
    async with SessionLocal() as session:
        stmt = tscope(select(Device), Device, _p()).order_by(Device.name)
        if group_id is not None:
            stmt = stmt.where(Device.group_id == group_id)
        if device_type:
            try:
                stmt = stmt.where(Device.device_type == DeviceType(device_type))
            except ValueError:
                return _result(False, None, f"device_type inválido: {device_type}")
        rows = (await session.execute(stmt)).scalars().all()
        data = [{"id": d.id, "name": d.name, "ip": d.ip, "device_type": d.device_type.value} for d in rows]
        return _result(True, data, count=len(data))


@mcp.tool()
async def buscar_device(termo: str) -> dict:
    """Busca um equipamento da ORG por nome (parcial) ou IP."""
    async with SessionLocal() as session:
        like = f"%{termo}%"
        rows = (
            await session.execute(
                tscope(select(Device), Device, _p()).where(or_(Device.name.ilike(like), Device.ip.ilike(like)))
            )
        ).scalars().all()
        data = [{"id": d.id, "name": d.name, "ip": d.ip, "device_type": d.device_type.value} for d in rows]
        return _result(True, data, count=len(data))


@mcp.tool()
async def executar_comando(device_id: int, command: str, protocol: str = "ssh") -> dict:
    """Executa um comando de LEITURA (SSH/Telnet). Escrita é recusada pela allowlist."""
    async with SessionLocal() as session:
        device = await _get_device(session, device_id)
        if device is None:
            return _result(False, None, "device não encontrado")
        try:
            proto = Protocol(protocol)
        except ValueError:
            return _result(False, None, "protocol deve ser 'ssh' ou 'telnet'")
        try:
            output = await runner.exec_command(
                session, actor=ACTOR, device=device, protocol=proto, command=command
            )
            return _result(True, {"output": output})
        except WriteBlocked as e:
            return _result(False, None, str(e))
        except (CredentialNotFound, DriverError) as e:
            return _result(False, None, str(e))


async def _snmp(device_id: int, oid: str, walk: bool) -> dict:
    async with SessionLocal() as session:
        device = await _get_device(session, device_id)
        if device is None:
            return _result(False, None, "device não encontrado")
        try:
            records = await runner.exec_snmp(session, actor=ACTOR, device=device, oid=oid, walk=walk)
            return _result(True, records, count=len(records))
        except (CredentialNotFound, DriverError) as e:
            return _result(False, None, str(e))


@mcp.tool()
async def snmp_get(device_id: int, oid: str) -> dict:
    """SNMP GET de um OID em um equipamento."""
    return await _snmp(device_id, oid, walk=False)


@mcp.tool()
async def snmp_walk(device_id: int, oid: str) -> dict:
    """SNMP WALK de um OID em um equipamento."""
    return await _snmp(device_id, oid, walk=True)


async def _fh_call(controller_id: int, op) -> dict:
    """Resolve controller+credencial e roda uma operação TL1 read-only do Fiberhome.

    `op(controller, credential)` deve devolver uma coroutine do módulo `fiberhome`.
    """
    async with SessionLocal() as session:
        controller = (
            await session.execute(select(Controller).where(Controller.id == controller_id))
        ).scalar_one_or_none()
        if not _owns(controller, _p()):
            return _result(False, None, "controller não encontrado")
        cred = None
        if controller.credential_id is not None:
            cred = (
                await session.execute(select(Credential).where(Credential.id == controller.credential_id))
            ).scalar_one_or_none()
        try:
            return _result(True, await op(controller, cred))
        except DriverError as e:
            return _result(False, None, str(e))


# --- Fiberhome: nível OLT ---


@mcp.tool()
async def listar_olts(controller_id: int) -> dict:
    """Lista as OLTs ao vivo de uma controladora Fiberhome (UNM2000) via TL1 (LST-DEVICE)."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.list_olts(c, cr))


@mcp.tool()
async def info_olt(controller_id: int, olt_ip: str) -> dict:
    """Detalhe de uma OLT específica (LST-DEVICE OLTID)."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.olt_info(c, cr, olt_ip))


@mcp.tool()
async def listar_placas(controller_id: int, olt_ip: str) -> dict:
    """Lista as placas/boards de uma OLT (LST-BOARD)."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.olt_boards(c, cr, olt_ip))


@mcp.tool()
async def listar_shelves(controller_id: int, olt_ip: str) -> dict:
    """Lista os shelves/subracks de uma OLT (LST-SHELF)."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.olt_shelves(c, cr, olt_ip))


@mcp.tool()
async def listar_pons(controller_id: int, olt_ip: str, ponid: str | None = None) -> dict:
    """Lista as portas PON de uma OLT (LST-PONINFO)."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.list_pons(c, cr, olt_ip, ponid))


@mcp.tool()
async def listar_onus(controller_id: int, olt_ip: str, ponid: str | None = None) -> dict:
    """Lista as ONUs de uma OLT (ou de uma PON específica) — LST-ONU."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.list_onus(c, cr, olt_ip, ponid))


@mcp.tool()
async def estado_onus(controller_id: int, olt_ip: str) -> dict:
    """Estado (Admin/Oper) de todas as ONUs de uma OLT — LST-ONUSTATE em lote."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.onu_states(c, cr, olt_ip))


@mcp.tool()
async def onus_nao_registradas(controller_id: int, olt_ip: str) -> dict:
    """Lista ONUs não autorizadas/registradas em uma OLT (LST-UNREGONU)."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.onu_unregistered(c, cr, olt_ip))


@mcp.tool()
async def alarmes_olt(
    controller_id: int, olt_ip: str, start: str | None = None, end: str | None = None
) -> dict:
    """Consulta alarmes de uma OLT (QUERY-ALARM)."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.olt_alarms(c, cr, olt_ip, start, end))


# --- Fiberhome: nível ONU ---


@mcp.tool()
async def localizar_onu(controller_id: int, olt_ip: str, onuid: str, onutype: str = "MAC") -> dict:
    """Localiza uma ONU pelo ID (MAC/LOID) e consolida estado, sinal, info, LAN, config e MAC."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.locate_onu(c, cr, olt_ip, onuid, onutype))


@mcp.tool()
async def estado_onu(controller_id: int, olt_ip: str, ponid: str, onuid: str, onutype: str = "MAC") -> dict:
    """Estado de uma ONU específica (LST-ONUSTATE)."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.onu_state(c, cr, olt_ip, ponid, onuid, onutype))


@mcp.tool()
async def sinal_onu(controller_id: int, olt_ip: str, ponid: str, onuid: str, onutype: str = "MAC") -> dict:
    """Sinal óptico (DDM) de uma ONU — potências RX/TX (LST-OMDDM)."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.onu_optical(c, cr, olt_ip, ponid, onuid, onutype))


@mcp.tool()
async def info_onu(controller_id: int, olt_ip: str, ponid: str, onuid: str, onutype: str = "MAC") -> dict:
    """Informações de hardware/firmware da ONU (LST-DEVINFO)."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.onu_info(c, cr, olt_ip, ponid, onuid, onutype))


@mcp.tool()
async def lan_onu(controller_id: int, olt_ip: str, ponid: str, onuid: str, onutype: str = "MAC") -> dict:
    """Portas LAN da ONU (LST-LANPORT)."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.onu_lan(c, cr, olt_ip, ponid, onuid, onutype))


@mcp.tool()
async def config_onu(controller_id: int, olt_ip: str, ponid: str, onuid: str, onutype: str = "MAC") -> dict:
    """Configuração da ONU (LST-ONUCFG)."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.onu_config(c, cr, olt_ip, ponid, onuid, onutype))


@mcp.tool()
async def wan_onu(controller_id: int, olt_ip: str, ponid: str, onuid: str, onutype: str = "MAC") -> dict:
    """Serviços WAN da ONU (LST-ONUWANSERVICECFG)."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.onu_wan(c, cr, olt_ip, ponid, onuid, onutype))


@mcp.tool()
async def macs_onu(controller_id: int, olt_ip: str, ponid: str, onuid: str, onutype: str = "MAC") -> dict:
    """Tabela de endereços MAC aprendidos pela ONU (LST-ONUMACADDRESS)."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.onu_macaddress(c, cr, olt_ip, ponid, onuid, onutype))


@mcp.tool()
async def laninfo_onu(controller_id: int, olt_ip: str, ponid: str, onuid: str, onutype: str = "MAC") -> dict:
    """Status das portas LAN da ONU (LST-ONULANINFO)."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.onu_laninfo(c, cr, olt_ip, ponid, onuid, onutype))


@mcp.tool()
async def portvlan_onu(
    controller_id: int, olt_ip: str, ponid: str, onuid: str, onutype: str = "MAC", onuport: str | None = None
) -> dict:
    """VLANs por porta da ONU (LST-PORTVLAN)."""
    return await _fh_call(
        controller_id, lambda c, cr: fiberhome.onu_portvlan(c, cr, olt_ip, ponid, onuid, onutype, onuport)
    )


@mcp.tool()
async def servico_onu(controller_id: int, olt_ip: str, ponid: str, onuid: str, onutype: str = "MAC") -> dict:
    """Status de serviço da ONU (LST-ONUSERVICESTATUS)."""
    return await _fh_call(controller_id, lambda c, cr: fiberhome.onu_service(c, cr, olt_ip, ponid, onuid, onutype))
