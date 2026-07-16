import atexit
import os
import threading
from datetime import datetime, timezone
from typing import Any, Optional

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

from fiberhome_config import get_inventory_path, load_config
from fiberhome_tl1 import FiberhomeTL1
from sync_engine import SyncEngine

load_dotenv()

INVENTORY_PATH: str = get_inventory_path()
SYNC_INTERVAL_MINUTES: int = int(os.getenv("SYNC_INTERVAL_MINUTES", "30"))
SYNC_MAX_WORKERS: int = int(os.getenv("SYNC_MAX_WORKERS", "3"))
MCP_HOST: str = os.getenv("HOST", "127.0.0.1")
MCP_PORT: int = int(os.getenv("PORT", "8803"))
MCP_TRANSPORT: str = os.getenv("MCP_TRANSPORT", "streamable-http")
MCP_PATH: str = os.getenv("MCP_PATH", "/mcp")

mcp = FastMCP(
    "fiberhome-unm2000",
    host=MCP_HOST,
    port=MCP_PORT,
    streamable_http_path=MCP_PATH,
)

_engine: Optional[SyncEngine] = None
_sync_thread: Optional[threading.Thread] = None
_start_time: Optional[datetime] = None
_lock = threading.Lock()


def _env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


MCP_ALLOW_ONU_RESET: bool = _env_flag("MCP_ALLOW_ONU_RESET", False)


def _load_config() -> dict:
    return load_config(INVENTORY_PATH)


def _resolve_olt(config: dict, olt: str) -> dict:
    olt_ref = olt.strip()
    if not olt_ref:
        raise ValueError("olt não pode ser vazio")

    for item in config.get("olts", []):
        if item.get("ip") == olt_ref or item.get("nome", "").lower() == olt_ref.lower():
            return item

    if "." in olt_ref:
        return {"ip": olt_ref, "nome": olt_ref}
    return {"nome": olt_ref}


def _connect_tl1(config: dict) -> FiberhomeTL1:
    unm = config["unm2000"]
    tl1 = FiberhomeTL1(unm["ip"], unm.get("porta", 3337))
    tl1.connect()
    tl1.login(unm["usuario"], unm["senha"])
    return tl1


def _tl1_call(callback) -> Any:
    config = _load_config()
    tl1 = None
    try:
        tl1 = _connect_tl1(config)
        return callback(tl1, config)
    finally:
        if tl1 is not None:
            tl1.logout()


def _json_safe(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    return value


def _parse_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str) and value:
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _format_datetime_br(value: Any) -> Optional[str]:
    dt = _parse_datetime(value)
    if dt is None:
        return None
    local_dt = dt.astimezone()
    return local_dt.strftime("%d/%m/%Y %H:%M:%S")


def _sync_time_info(value: Any) -> dict:
    dt = _parse_datetime(value)
    br = _format_datetime_br(value)
    if dt is None or br is None:
        return {
            "last_sync_at_br": None,
            "sync_age_minutes": None,
            "last_sync_description": None,
        }

    age_minutes = int((datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() // 60)
    return {
        "last_sync_at_br": br,
        "sync_age_minutes": age_minutes,
        "last_sync_description": f"Última sincronização ({age_minutes} Minutos) {br}",
    }


def _get_engine() -> SyncEngine:
    global _engine, _sync_thread, _start_time

    with _lock:
        if _engine is None:
            config = _load_config()
            _engine = SyncEngine(config, SYNC_INTERVAL_MINUTES, SYNC_MAX_WORKERS)
            _start_time = datetime.now(timezone.utc)

        if _env_flag("MCP_START_SYNC", True) and (_sync_thread is None or not _sync_thread.is_alive()):
            _sync_thread = threading.Thread(target=_engine.run, daemon=True)
            _sync_thread.start()

        return _engine


def _stop_engine() -> None:
    if _engine is not None:
        _engine.stop()


atexit.register(_stop_engine)


def _result(ok: bool, data: Any = None, error: Optional[str] = None, **meta: Any) -> dict:
    payload = {"ok": ok, "data": _json_safe(data), "error": error}
    payload.update(_json_safe(meta))
    return payload


def _with_realtime(engine: SyncEngine, onu: dict, realtime: bool) -> dict:
    data = dict(onu)
    if realtime:
        data["realtime"] = engine.fetch_realtime(data["olt_ip"], data["ponid"], data["mac"])
    return data


def _lookup_one_onu(engine: SyncEngine, mac: Optional[str], nome: Optional[str]) -> tuple[Optional[dict], Optional[str]]:
    if mac and mac.strip():
        results = engine.search_by_mac(mac.strip())
    elif nome and nome.strip():
        results = engine.search_by_name(nome.strip(), "partial")
    else:
        return None, "informe mac ou nome"

    if not results:
        return None, "ONU não encontrada"
    if len(results) > 1:
        return None, "múltiplas ONUs encontradas; informe o MAC para identificar uma única ONU"
    return dict(results[0]), None


def _normalize_pon_ports(records: Any) -> tuple[Any, dict]:
    if not isinstance(records, list):
        return records, {}

    normalized = []
    summary = {"total": 0, "up": 0, "down": 0, "unknown": 0}
    for idx, rec in enumerate(records, start=1):
        if not isinstance(rec, dict):
            continue

        admin_state = rec.get("AdminState") or rec.get("ADMINSTATE") or rec.get("admin_state") or ""
        oper_state = rec.get("OperState") or rec.get("OPERSTATE") or rec.get("oper_state") or ""
        ponid = (
            rec.get("PONID")
            or rec.get("PON")
            or rec.get("PORTID")
            or rec.get("PonPort")
            or rec.get("PONPORT")
            or rec.get("Port")
            or rec.get("PORT")
            or str(idx)
        )

        status = str(oper_state or "").upper()
        if status == "UP":
            summary["up"] += 1
        elif status == "DOWN":
            summary["down"] += 1
        else:
            summary["unknown"] += 1

        item = {
            "porta_pon": idx,
            "ponid": ponid,
            "admin_state": admin_state,
            "oper_state": oper_state,
        }
        item.update(rec)
        normalized.append(item)

    summary["total"] = len(normalized)
    return normalized, summary


def _record_text(rec: dict) -> str:
    return " ".join(str(value) for value in rec.values()).lower()


def _record_name(rec: dict) -> str:
    return (
        rec.get("NAME")
        or rec.get("Name")
        or rec.get("LOID")
        or rec.get("LogicalID")
        or rec.get("ALIAS")
        or rec.get("Alias")
        or ""
    )


def _record_onuid(rec: dict) -> str:
    return (
        rec.get("ONUID")
        or rec.get("ONUId")
        or rec.get("MAC")
        or rec.get("AUTHINFO")
        or rec.get("Physical Address")
        or rec.get("PhysicalAddress")
        or ""
    )


def _record_ponid(rec: dict) -> str:
    ponid = rec.get("PONID") or rec.get("PONID".lower()) or rec.get("PONID".title()) or ""
    if ponid:
        return ponid

    slot = rec.get("SlotNo") or rec.get("SLOTNO") or rec.get("Slot") or rec.get("SLOT") or rec.get("Slot No.") or ""
    pon = rec.get("PonNo") or rec.get("PONNO") or rec.get("Pon") or rec.get("PON") or rec.get("PON No.") or ""
    if slot and pon:
        return f"NA-NA-{slot}-{pon}"
    return ""


def _find_onu_record(records: Any, nome: Optional[str], mac: Optional[str]) -> tuple[Optional[dict], Optional[str]]:
    if not isinstance(records, list):
        return None, "resposta TL1 não retornou lista de ONUs"

    query = (mac or nome or "").strip().lower()
    if not query:
        return None, "informe mac ou nome"

    matches = []
    for rec in records:
        if not isinstance(rec, dict):
            continue
        if query in _record_text(rec):
            matches.append(rec)

    if not matches:
        return None, "ONU não encontrada no TL1 da OLT informada"
    if len(matches) > 1:
        return None, "múltiplas ONUs encontradas no TL1; informe MAC ou nome mais específico"
    return matches[0], None


def _realtime_from_tl1(tl1: FiberhomeTL1, olt_ip: str, ponid: str, onuid: str, onutype: str = "MAC") -> dict:
    state_records = tl1.onu_state(olt_ip, ponid, onuid, onutype)
    optical_records = tl1.onu_optical(olt_ip, ponid, onuid, onutype)
    lan_records = tl1.onu_lan(olt_ip, ponid, onuid, onutype)

    state_rec = state_records[0] if isinstance(state_records, list) and state_records else {}
    optical_rec = optical_records[0] if isinstance(optical_records, list) and optical_records else {}

    lan_ports = []
    if isinstance(lan_records, list):
        for port_rec in lan_records:
            admin = port_rec.get("ADMINSTATUS", "") or port_rec.get("LINKSTATE", "")
            lan_ports.append({
                "port": port_rec.get("PORTID") or port_rec.get("ONUPORT", ""),
                "connected": str(admin).lower() not in ("", "--", "down", "disabled", "unlinked"),
                "speed": port_rec.get("SPEED", ""),
                "raw": port_rec,
            })

    rx_raw = optical_rec.get("RxPower") or optical_rec.get("RXPOWER") or optical_rec.get("RX_POWER") or ""
    try:
        rx = float(str(rx_raw).replace(",", "."))
    except (TypeError, ValueError):
        rx = None

    return {
        "state": (
            state_rec.get("AdminState")
            or state_rec.get("OperState")
            or state_rec.get("ONUSTATE")
            or state_rec.get("STATE")
            or "unknown"
        ),
        "oper_state": state_rec.get("OperState", ""),
        "uptime": state_rec.get("UPTIME") or state_rec.get("DURATION") or "",
        "last_offline": state_rec.get("LASTOFFTIME", ""),
        "rx_signal_dbm": rx,
        "lan_ports": lan_ports,
        "state_raw": state_records,
        "optical_raw": optical_records,
        "from_cache": False,
    }


def _find_onu_realtime_in_olt(olt: str, nome: Optional[str] = None, mac: Optional[str] = None) -> tuple[dict, Optional[dict], Optional[str]]:
    def call(tl1: FiberhomeTL1, config: dict):
        olt_info = _resolve_olt(config, olt)
        records = tl1.onu_list(olt_info["ip"])
        rec, find_error = _find_onu_record(records, nome, mac)
        if find_error:
            return olt_info, None, find_error

        onuid = _record_onuid(rec)
        ponid = _record_ponid(rec)
        if not onuid:
            return olt_info, rec, "ONU encontrada, mas sem identificador/MAC na resposta TL1"
        if not ponid:
            return olt_info, rec, "ONU encontrada, mas sem PONID/slot/pon na resposta TL1"

        realtime = _realtime_from_tl1(tl1, olt_info["ip"], ponid, onuid)
        data = {
            "mac": onuid,
            "loid": _record_name(rec),
            "olt_name": olt_info.get("nome", ""),
            "olt_ip": olt_info["ip"],
            "ponid": ponid,
            "raw": rec,
            "realtime": realtime,
        }
        return olt_info, data, None

    return _tl1_call(call)


def _find_onu_realtime_in_all_olts(nome: Optional[str] = None, mac: Optional[str] = None) -> tuple[Optional[dict], Optional[dict], Optional[str]]:
    def call(tl1: FiberhomeTL1, config: dict):
        matches = []
        errors = []

        for olt_info in config.get("olts", []):
            try:
                records = tl1.onu_list(olt_info["ip"])
                rec, find_error = _find_onu_record(records, nome, mac)
                if find_error:
                    if not find_error.startswith("ONU não encontrada"):
                        errors.append({"olt": olt_info, "error": find_error})
                    continue

                onuid = _record_onuid(rec)
                ponid = _record_ponid(rec)
                if not onuid or not ponid:
                    errors.append({"olt": olt_info, "error": "ONU encontrada sem identificador ou PONID", "raw": rec})
                    continue

                matches.append((olt_info, rec, onuid, ponid))
            except Exception as e:
                errors.append({"olt": olt_info, "error": str(e)})

        if not matches:
            return None, {"errors": errors}, "ONU não encontrada no Mongo nem nas OLTs cadastradas"
        if len(matches) > 1:
            return None, {
                "matches": [
                    {
                        "olt": olt_info,
                        "mac": onuid,
                        "loid": _record_name(rec),
                        "ponid": ponid,
                        "raw": rec,
                    }
                    for olt_info, rec, onuid, ponid in matches
                ],
                "errors": errors,
            }, "múltiplas ONUs encontradas; informe a OLT ou o MAC"

        olt_info, rec, onuid, ponid = matches[0]
        realtime = _realtime_from_tl1(tl1, olt_info["ip"], ponid, onuid)
        data = {
            "mac": onuid,
            "loid": _record_name(rec),
            "olt_name": olt_info.get("nome", ""),
            "olt_ip": olt_info["ip"],
            "ponid": ponid,
            "raw": rec,
            "realtime": realtime,
        }
        return olt_info, data, None

    return _tl1_call(call)


@mcp.tool()
def health() -> dict:
    """Verifica saúde do serviço MCP, MongoDB e dados de sincronização."""
    try:
        engine = _get_engine()
        uptime = int((datetime.now(timezone.utc) - _start_time).total_seconds()) if _start_time else 0
        data = {
            "status": "ok",
            "uptime_seconds": uptime,
            "sync_interval_minutes": SYNC_INTERVAL_MINUTES,
            "sync_max_workers": SYNC_MAX_WORKERS,
            "sync_background_enabled": _env_flag("MCP_START_SYNC", True),
            "transport": MCP_TRANSPORT,
            "host": MCP_HOST,
            "port": MCP_PORT,
            "path": MCP_PATH if MCP_TRANSPORT == "streamable-http" else None,
        }
        data.update(engine.get_health_extras())
        return _result(True, data, source="mcp")
    except Exception as e:
        return _result(False, None, str(e), source="mcp")


@mcp.tool()
def listar_olts() -> dict:
    """Lista as OLTs configuradas no inventário Fiberhome."""
    try:
        config = _load_config()
        return _result(True, config.get("olts", []), count=len(config.get("olts", [])))
    except Exception as e:
        return _result(False, None, str(e))


@mcp.tool()
def status_sincronizacao() -> dict:
    """Mostra o status do último ciclo de sincronização por OLT."""
    try:
        items = _get_engine().get_sync_status()
        return _result(True, items, count=len(items))
    except Exception as e:
        return _result(False, None, str(e))


@mcp.tool()
def listar_onus(olt_ip: Optional[str] = None, page: int = 1, limit: int = 100) -> dict:
    """Lista ONUs salvas no MongoDB, com filtro opcional por OLT."""
    if page < 1:
        return _result(False, None, "page deve ser maior ou igual a 1")
    if limit < 1 or limit > 1000:
        return _result(False, None, "limit deve ficar entre 1 e 1000")

    try:
        items = _get_engine().list_onus(olt_ip, page, limit)
        return _result(True, items, count=len(items), page=page, limit=limit)
    except Exception as e:
        return _result(False, None, str(e))


@mcp.tool()
def contar_onus_por_estado(
    olt: Optional[str] = None,
    slot: Optional[str] = None,
    pon: Optional[str] = None,
    estado: Optional[str] = None,
) -> dict:
    """Conta ONUs/ONTs por estado operacional no MongoDB/cache, com filtros de OLT, slot e PON."""
    try:
        engine = _get_engine()
        olt_info = None
        olt_ip = None
        olt_name = None

        if olt and olt.strip():
            config = _load_config()
            olt_info = _resolve_olt(config, olt)
            if "ip" in olt_info:
                olt_ip = olt_info["ip"]
            else:
                olt_name = olt_info.get("nome") or olt.strip()

        data = engine.count_onus_by_state(
            olt_ip=olt_ip,
            olt_name=olt_name,
            slot=slot,
            pon=pon,
            state=estado,
        )
        return _result(True, data, count=data["total"], olt=olt_info, source="database")
    except Exception as e:
        return _result(False, None, str(e), source="database")


@mcp.tool()
def listar_onus_por_estado(
    olt: Optional[str] = None,
    slot: Optional[str] = None,
    pon: Optional[str] = None,
    estado: Optional[str] = None,
    page: int = 1,
    limit: int = 100,
    realtime: bool = False,
    realtime_limit: int = 10,
) -> dict:
    """Lista ONUs/ONTs por estado operacional no MongoDB/cache, com opção limitada de realtime."""
    if page < 1:
        return _result(False, None, "page deve ser maior ou igual a 1")
    if limit < 1 or limit > 1000:
        return _result(False, None, "limit deve ficar entre 1 e 1000")
    if realtime_limit < 1 or realtime_limit > 20:
        return _result(False, None, "realtime_limit deve ficar entre 1 e 20")

    try:
        engine = _get_engine()
        olt_info = None
        olt_ip = None
        olt_name = None

        if olt and olt.strip():
            config = _load_config()
            olt_info = _resolve_olt(config, olt)
            if "ip" in olt_info:
                olt_ip = olt_info["ip"]
            else:
                olt_name = olt_info.get("nome") or olt.strip()

        data = engine.list_onus_by_state(
            olt_ip=olt_ip,
            olt_name=olt_name,
            slot=slot,
            pon=pon,
            state=estado,
            page=page,
            limit=limit,
        )

        sync_status = engine.get_olt_sync_status(olt_ip) if olt_ip else None
        data["sync_status"] = sync_status
        data["last_sync_at"] = sync_status.get("last_sync_at") if sync_status else None
        data.update(_sync_time_info(data["last_sync_at"]))

        if realtime:
            enriched = []
            for onu in data["items"][:realtime_limit]:
                item = dict(onu)
                try:
                    item["realtime"] = engine.fetch_realtime(item["olt_ip"], item["ponid"], item["mac"])
                except Exception as e:
                    item["realtime"] = {"error": str(e)}
                enriched.append(item)

            data["items"] = enriched + data["items"][realtime_limit:]
            data["realtime"] = {
                "enabled": True,
                "limit": realtime_limit,
                "enriched": len(enriched),
                "note": "Realtime limitado aos primeiros itens da página para evitar excesso de consultas TL1.",
            }
        else:
            data["realtime"] = {"enabled": False}

        return _result(True, data, count=data["total"], olt=olt_info, source="database")
    except Exception as e:
        return _result(False, None, str(e), source="database")


@mcp.tool()
def listar_onus_aguardando_registro(olt: Optional[str] = None) -> dict:
    """Lista ONUs aguardando registro/autorização em uma OLT ou em todas as OLTs."""
    try:
        def call(tl1: FiberhomeTL1, config: dict):
            if olt and olt.strip():
                olt_info = _resolve_olt(config, olt)
                return False, olt_info, tl1.onu_unregistered(olt_info["ip"])

            results = []
            for olt_info in config.get("olts", []):
                try:
                    items = tl1.onu_unregistered(olt_info["ip"])
                    count = len(items) if isinstance(items, list) else 0
                    results.append({
                        "olt": olt_info,
                        "ok": not (isinstance(items, dict) and "error" in items),
                        "count": count,
                        "onus": items if isinstance(items, list) else [],
                        "error": items.get("error") if isinstance(items, dict) else None,
                    })
                except Exception as e:
                    results.append({
                        "olt": olt_info,
                        "ok": False,
                        "count": 0,
                        "onus": [],
                        "error": str(e),
                    })
            return True, None, results

        all_olts, olt_info, items = _tl1_call(call)
        if all_olts:
            total_pending = sum(item["count"] for item in items)
            olts_with_pending = [item for item in items if item["count"] > 0]
            errors = [item for item in items if not item["ok"]]
            summary = {
                "total_olts_checked": len(items),
                "olts_with_pending": len(olts_with_pending),
                "total_pending": total_pending,
                "errors": len(errors),
            }
            return _result(
                True,
                items,
                count=len(items),
                summary=summary,
                total_pending=total_pending,
                olts_with_pending=olts_with_pending,
                source="tl1",
            )

        if isinstance(items, dict) and "error" in items:
            return _result(False, items, items["error"], olt=olt_info)
        return _result(True, items, count=len(items) if isinstance(items, list) else None, olt=olt_info, source="tl1")
    except Exception as e:
        return _result(False, None, str(e), source="tl1")


@mcp.tool()
def listar_pons_disponiveis(olt: str) -> dict:
    """Lista informações das PONs de uma OLT para identificar portas disponíveis."""
    try:
        def call(tl1: FiberhomeTL1, config: dict):
            olt_info = _resolve_olt(config, olt)
            return olt_info, tl1.olt_poninfo(olt_info["ip"])

        olt_info, items = _tl1_call(call)
        if isinstance(items, dict) and "error" in items:
            return _result(False, items, items["error"], olt=olt_info)
        ports, summary = _normalize_pon_ports(items)
        return _result(True, ports, count=len(ports) if isinstance(ports, list) else None, summary=summary, olt=olt_info, source="tl1")
    except Exception as e:
        return _result(False, None, str(e), source="tl1")


@mcp.tool()
def listar_onus_em_pon(olt: str, ponid: str) -> dict:
    """Lista ONUs/ONTs registradas em uma PON específica."""
    if not ponid.strip():
        return _result(False, None, "ponid não pode ser vazio")

    try:
        def call(tl1: FiberhomeTL1, config: dict):
            olt_info = _resolve_olt(config, olt)
            return olt_info, tl1.onu_list(olt_info["ip"], ponid.strip())

        olt_info, items = _tl1_call(call)
        if isinstance(items, dict) and "error" in items:
            return _result(False, items, items["error"], olt=olt_info, ponid=ponid)
        return _result(True, items, count=len(items) if isinstance(items, list) else None, olt=olt_info, ponid=ponid, source="tl1")
    except Exception as e:
        return _result(False, None, str(e), source="tl1")


@mcp.tool()
def buscar_onu_por_mac(mac: str, realtime: bool = True) -> dict:
    """Busca uma ONU por MAC/identificador Fiberhome e opcionalmente consulta dados em tempo real."""
    if not mac.strip():
        return _result(False, None, "mac não pode ser vazio")

    try:
        engine = _get_engine()
        results = engine.search_by_mac(mac.strip())
        if not results:
            return _result(False, None, "ONU não encontrada", count=0)

        if len(results) > 1:
            return _result(True, results, count=len(results), realtime=False)

        onu = _with_realtime(engine, results[0], realtime)
        source = "cache" if onu.get("realtime", {}).get("from_cache") else ("realtime" if realtime else "database")
        return _result(True, onu, count=1, source=source)
    except Exception as e:
        return _result(False, None, str(e))


@mcp.tool()
def diagnostico_sinal_onu(mac: Optional[str] = None, nome: Optional[str] = None, olt: Optional[str] = None) -> dict:
    """Consulta diagnóstico de sinal/estado de uma ONU em tempo real pelo MAC ou nome."""
    try:
        engine = _get_engine()
        onu, error = _lookup_one_onu(engine, mac, nome)
        if error and olt and (nome or mac):
            olt_info, data, tl1_error = _find_onu_realtime_in_olt(olt, nome=nome, mac=mac)
            if tl1_error:
                return _result(False, data, tl1_error, olt=olt_info, source="tl1")
            return _result(True, data, count=1, source="tl1")

        if error:
            return _result(False, None, error)

        data = _with_realtime(engine, onu, True)
        source = "cache" if data.get("realtime", {}).get("from_cache") else "realtime"
        return _result(True, data, count=1, source=source)
    except Exception as e:
        return _result(False, None, str(e))


@mcp.tool()
def buscar_onu_por_nome(nome: str, modo: str = "partial", realtime: bool = True) -> dict:
    """Busca ONUs pelo nome/LOID do cliente exclusivamente no MongoDB."""
    nome = nome.strip()
    if not nome:
        return _result(False, None, "nome não pode ser vazio")
    if modo not in ("exact", "partial"):
        return _result(False, None, "modo deve ser 'exact' ou 'partial'")

    try:
        engine = _get_engine()
        results = engine.search_by_name(nome, modo)
        if not results:
            return _result(False, None, "ONU não encontrada", count=0)

        if len(results) > 1:
            return _result(True, results, count=len(results), realtime=False)

        onu = _with_realtime(engine, results[0], realtime)
        source = "cache" if onu.get("realtime", {}).get("from_cache") else ("realtime" if realtime else "database")
        return _result(True, onu, count=1, source=source)
    except Exception as e:
        return _result(False, None, str(e))


@mcp.tool()
def verificar_configuracoes_onu(
    mac: Optional[str] = None,
    nome: Optional[str] = None,
    olt: Optional[str] = None,
    ponid: Optional[str] = None,
    onuid: Optional[str] = None,
    onutype: str = "MAC",
    onuport: Optional[str] = None,
) -> dict:
    """Verifica configurações e status de uma ONU/ONT: VLAN, portas LAN, WAN, estado e sinal."""
    try:
        engine = _get_engine()
        onu = None
        if mac or nome:
            onu, error = _lookup_one_onu(engine, mac, nome)
            if error:
                return _result(False, None, error)

        olt_ref = olt or (onu or {}).get("olt_ip")
        pon_ref = ponid or (onu or {}).get("ponid")
        onu_ref = onuid or (onu or {}).get("mac")

        if not olt_ref or not pon_ref or not onu_ref:
            return _result(False, None, "informe mac/nome cadastrado ou olt, ponid e onuid")

        def call(tl1: FiberhomeTL1, config: dict):
            olt_info = _resolve_olt(config, olt_ref)
            olt_ip = olt_info["ip"]
            return olt_info, {
                "state": tl1.onu_state(olt_ip, pon_ref, onu_ref, onutype),
                "optical": tl1.onu_optical(olt_ip, pon_ref, onu_ref, onutype),
                "info": tl1.onu_info(olt_ip, pon_ref, onu_ref, onutype),
                "lan_ports": tl1.onu_lan(olt_ip, pon_ref, onu_ref, onutype),
                "config": tl1.onu_config(olt_ip, pon_ref, onu_ref, onutype),
                "wan": tl1.onu_wan(olt_ip, pon_ref, onu_ref, onutype),
                "macaddress": tl1.onu_macaddress(olt_ip, pon_ref, onu_ref, onutype),
                "lan_info": tl1.onu_laninfo(olt_ip, pon_ref, onu_ref, onutype),
                "port_vlan": tl1.onu_portvlan(olt_ip, pon_ref, onu_ref, onutype, onuport),
                "service": tl1.onu_service_status(olt_ip, pon_ref, onu_ref, onutype),
            }

        olt_info, data = _tl1_call(call)
        if onu:
            data["onu"] = onu
        return _result(True, data, olt=olt_info, ponid=pon_ref, onuid=onu_ref, source="tl1")
    except Exception as e:
        return _result(False, None, str(e), source="tl1")


@mcp.tool()
def reiniciar_onu(
    mac: Optional[str] = None,
    nome: Optional[str] = None,
    olt: Optional[str] = None,
    ponid: Optional[str] = None,
    onuid: Optional[str] = None,
    onutype: str = "MAC",
    confirmar: bool = False,
) -> dict:
    """Reinicia uma ONU/ONT. Requer MCP_ALLOW_ONU_RESET=true e confirmar=true."""
    if not MCP_ALLOW_ONU_RESET:
        return _result(False, None, "reiniciar ONU está desabilitado; defina MCP_ALLOW_ONU_RESET=true no servidor")
    if not confirmar:
        return _result(False, None, "confirmação obrigatória: chame novamente com confirmar=true")

    try:
        engine = _get_engine()
        onu = None
        if mac or nome:
            onu, error = _lookup_one_onu(engine, mac, nome)
            if error:
                return _result(False, None, error)

        olt_ref = olt or (onu or {}).get("olt_ip")
        pon_ref = ponid or (onu or {}).get("ponid")
        onu_ref = onuid or (onu or {}).get("mac")

        if not olt_ref or not pon_ref or not onu_ref:
            return _result(False, None, "informe mac/nome cadastrado ou olt, ponid e onuid")

        def call(tl1: FiberhomeTL1, config: dict):
            olt_info = _resolve_olt(config, olt_ref)
            return olt_info, tl1.onu_reset(olt_info["ip"], pon_ref, onu_ref, onutype)

        olt_info, data = _tl1_call(call)
        if isinstance(data, dict) and "error" in data:
            return _result(False, data, data["error"], olt=olt_info, ponid=pon_ref, onuid=onu_ref, source="tl1")
        return _result(True, data, olt=olt_info, ponid=pon_ref, onuid=onu_ref, source="tl1")
    except Exception as e:
        return _result(False, None, str(e), source="tl1")


def run_server() -> None:
    if MCP_TRANSPORT not in ("stdio", "sse", "streamable-http"):
        raise ValueError("MCP_TRANSPORT deve ser 'stdio', 'sse' ou 'streamable-http'")
    mcp.run(transport=MCP_TRANSPORT)


if __name__ == "__main__":
    run_server()
