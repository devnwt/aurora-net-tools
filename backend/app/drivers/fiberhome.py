"""Driver Fiberhome TL1 (via UNM2000) — somente leitura no MVP (decisão §2/§4).

Portado de fiberhome_tl1.py. Mantém apenas o cliente TL1 (socket) e os comandos
de LEITURA (LST-*/QUERY-*). Os comandos de escrita do original foram omitidos.
"""

import asyncio
import socket

from app.core.crypto import decrypt
from app.drivers.base import DriverError
from app.models import Controller, Credential

ISOLATE_BLOCK = "-" * 80


class FiberhomeTL1:
    def __init__(self, host: str, port: int = 3337, timeout: int = 30):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.sock: socket.socket | None = None

    def connect(self) -> None:
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect((self.host, self.port))
        # Lê o banner (best-effort).
        try:
            self.sock.recv(4096)
        except TimeoutError:
            pass

    def login(self, username: str, password: str) -> None:
        ret = self.cmd(f"LOGIN:::CTAG::UN={username},PWD={password};")
        if not self._cmd_ok(ret):
            raise DriverError(f"falha na autenticação TL1: {ret[4] if len(ret) > 4 else ret}")

    def logout(self) -> None:
        try:
            self.cmd("LOGOUT:::CTAG::;")
        except Exception:
            pass
        if self.sock:
            self.sock.close()

    def cmd(self, command: str, sleep: float | None = None) -> list[str]:
        self.sock.sendall((command + "\n").encode("utf-8"))
        if sleep:
            import time

            time.sleep(sleep)
        buffer = ""
        while True:
            try:
                c = self.sock.recv(1).decode("utf-8", errors="replace")
                buffer += c
                if c == ";":
                    break
            except TimeoutError:
                break
        return [line.strip() for line in buffer.split("\n")]

    @staticmethod
    def _cmd_ok(ret: list[str]) -> bool:
        return len(ret) > 4 and "ENDESC=No error" in ret[4]

    def return_records(self, raw_list: list[str]):
        if len(raw_list) <= 4:
            return {"error": "Resposta vazia ou incompleta", "raw": raw_list}
        line4 = raw_list[4] if len(raw_list) > 4 else ""
        if "resource does not exist" in line4 or "invalid parameter format" in line4:
            return {"error": line4, "raw": raw_list}
        try:
            tmp = raw_list[4].split("=")
            total_blocks = int(tmp[1]) if len(tmp) > 1 else 0
        except (IndexError, ValueError):
            return {"error": "Não foi possível parsear resposta", "raw": raw_list}
        if total_blocks == 0:
            return []

        records_all = []
        titles: list[str] = []
        in_table = False
        for line_idx, line in enumerate(raw_list):
            if not line or line == ";":
                continue
            if line == ISOLATE_BLOCK:
                if line_idx + 1 < len(raw_list):
                    titles = [t.strip() for t in raw_list[line_idx + 1].split("\t") if t.strip()]
                    in_table = bool(titles)
                continue
            if not in_table:
                continue
            if line.split("\t") == titles:
                continue
            if "\t" not in line and (
                line.startswith(">") or line.startswith("M ") or "=" in line or line.startswith("List of ")
            ):
                in_table = False
                continue
            values = line.split("\t")
            if len(values) < len(titles):
                continue
            record = {titles[i]: (values[i].strip() if i < len(values) else "") for i in range(len(titles))}
            if record and record != {t: t for t in titles}:
                records_all.append(record)
        if not records_all and not titles:
            return {"error": "Formato de resposta não reconhecido", "raw": raw_list}
        return records_all

    # === Comandos de leitura (portados de fiberhome_tl1.py) ===

    # --- Nível OLT ---

    def list_olts(self):
        return self.return_records(self.cmd("LST-DEVICE:::CTAG::;"))

    def olt_info(self, olt_ip: str):
        return self.return_records(self.cmd(f"LST-DEVICE::OLTID={olt_ip}:CTAG::;"))

    def olt_boards(self, olt_ip: str):
        return self.return_records(self.cmd(f"LST-BOARD::OLTID={olt_ip}:CTAG::;"))

    def olt_shelves(self, olt_ip: str):
        return self.return_records(self.cmd(f"LST-SHELF::OLTID={olt_ip}:CTAG::;"))

    def olt_poninfo(self, olt_ip: str, ponid: str | None = None):
        q = f",PONID={ponid}" if ponid else ""
        return self.return_records(self.cmd(f"LST-PONINFO::OLTID={olt_ip}{q}:CTAG::;"))

    def onu_list(self, olt_ip: str, ponid: str | None = None):
        old = self.sock.gettimeout()
        self.sock.settimeout(120)
        try:
            if ponid:
                return self.return_records(self.cmd(f"LST-ONU::OLTID={olt_ip},PONID={ponid}:CTAG::;", sleep=4))
            return self.return_records(self.cmd(f"LST-ONU::OLTID={olt_ip}:CTAG::;", sleep=8))
        finally:
            self.sock.settimeout(old)

    def onu_state_bulk(self, olt_ip: str):
        """Estado (Admin/Oper/LASTOFFTIME) de TODAS as ONUs da OLT. Correlacionar por AUTHINFO (MAC)."""
        old = self.sock.gettimeout()
        self.sock.settimeout(120)
        try:
            return self.return_records(self.cmd(f"LST-ONUSTATE::OLTID={olt_ip}:CTAG::;", sleep=8))
        finally:
            self.sock.settimeout(old)

    def onu_unregistered(self, olt_ip: str):
        return self.return_records(self.cmd(f"LST-UNREGONU::OLTID={olt_ip}:CTAG::;"))

    def olt_alarms(self, olt_ip: str, start: str | None = None, end: str | None = None):
        begin = f"BEGINTIME={start}," if start else ""
        return self.cmd(f"QUERY-ALARM::OLTID={olt_ip}:CTAG::{begin}FAULTFLAG=ALL;")

    # --- Nível ONU ---

    def onu_query(self, olt_ip: str, onuid: str, onutype: str = "MAC"):
        """Localiza uma ONU pelo ID e consolida estado, sinal, info, LAN, config e MAC."""
        query = self.return_records(
            self.cmd(f"QUERY-ONUINFO::OLTID={olt_ip},ONUID={onuid},ONUIDTYPE={onutype}:CTAG::;")
        )
        if isinstance(query, dict) and "error" in query:
            return query
        record = query[0] if isinstance(query, list) and query else {}
        slot = record.get("SlotNo", "")
        pon = record.get("PonNo", "")
        ponid = f"NA-NA-{slot}-{pon}"
        return {
            "query": query,
            "state": self.onu_state(olt_ip, ponid, onuid, onutype),
            "optical": self.onu_optical(olt_ip, ponid, onuid, onutype),
            "info": self.onu_info(olt_ip, ponid, onuid, onutype),
            "lan_port": self.onu_lan(olt_ip, ponid, onuid, onutype),
            "config": self.onu_config(olt_ip, ponid, onuid, onutype),
            "macaddress": self.onu_macaddress(olt_ip, ponid, onuid, onutype),
            "lan_info": self.onu_laninfo(olt_ip, ponid, onuid, onutype),
        }

    def onu_state(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(
            self.cmd(f"LST-ONUSTATE::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;")
        )

    def onu_optical(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(
            self.cmd(f"LST-OMDDM::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;")
        )

    def onu_info(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(
            self.cmd(f"LST-DEVINFO::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;")
        )

    def onu_lan(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(
            self.cmd(f"LST-LANPORT::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;")
        )

    def onu_config(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(
            self.cmd(f"LST-ONUCFG::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;")
        )

    def onu_wan(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(
            self.cmd(f"LST-ONUWANSERVICECFG::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;")
        )

    def onu_macaddress(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(
            self.cmd(f"LST-ONUMACADDRESS::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;")
        )

    def onu_laninfo(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(
            self.cmd(f"LST-ONULANINFO::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;")
        )

    def onu_portvlan(self, olt_ip, ponid, onuid, onutype="MAC", onuport=None):
        port = f",ONUPORT={onuport}" if onuport else ""
        return self.return_records(
            self.cmd(f"LST-PORTVLAN::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}{port}:CTAG::;")
        )

    def onu_service_status(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(
            self.cmd(f"LST-ONUSERVICESTATUS::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;")
        )


# === Orquestração assíncrona (conecta, loga, executa callback, desconecta) ===


def _credentials(credential: Credential | None) -> tuple[str, str]:
    if credential is None:
        raise DriverError("controller sem credencial TL1 configurada")
    return credential.username, (decrypt(credential.secret) if credential.secret else "")


def _call_sync(host, port, username, password, callback):
    tl1 = FiberhomeTL1(host, port)
    try:
        tl1.connect()
        tl1.login(username, password)
        return callback(tl1)
    finally:
        tl1.logout()


async def call(controller: Controller, credential: Credential | None, callback):
    username, password = _credentials(credential)
    try:
        return await asyncio.to_thread(
            _call_sync, controller.host, controller.port, username, password, callback
        )
    except DriverError:
        raise
    except Exception as e:
        raise DriverError(f"TL1 falhou em {controller.host}:{controller.port}: {e}") from e


# --- Nível OLT ---


async def list_olts(controller: Controller, credential: Credential | None):
    return await call(controller, credential, lambda tl1: tl1.list_olts())


async def olt_info(controller: Controller, credential: Credential | None, olt_ip: str):
    return await call(controller, credential, lambda tl1: tl1.olt_info(olt_ip))


async def olt_boards(controller: Controller, credential: Credential | None, olt_ip: str):
    return await call(controller, credential, lambda tl1: tl1.olt_boards(olt_ip))


async def olt_shelves(controller: Controller, credential: Credential | None, olt_ip: str):
    return await call(controller, credential, lambda tl1: tl1.olt_shelves(olt_ip))


async def list_pons(controller: Controller, credential: Credential | None, olt_ip: str, ponid: str | None = None):
    return await call(controller, credential, lambda tl1: tl1.olt_poninfo(olt_ip, ponid))


async def list_onus(controller: Controller, credential: Credential | None, olt_ip: str, ponid: str | None = None):
    return await call(controller, credential, lambda tl1: tl1.onu_list(olt_ip, ponid))


async def onu_states(controller: Controller, credential: Credential | None, olt_ip: str):
    return await call(controller, credential, lambda tl1: tl1.onu_state_bulk(olt_ip))


async def onu_unregistered(controller: Controller, credential: Credential | None, olt_ip: str):
    return await call(controller, credential, lambda tl1: tl1.onu_unregistered(olt_ip))


async def olt_alarms(
    controller: Controller, credential: Credential | None, olt_ip: str, start: str | None = None, end: str | None = None
):
    return await call(controller, credential, lambda tl1: tl1.olt_alarms(olt_ip, start, end))


# --- Nível ONU ---


async def locate_onu(controller: Controller, credential: Credential | None, olt_ip: str, onuid: str, onutype: str = "MAC"):
    return await call(controller, credential, lambda tl1: tl1.onu_query(olt_ip, onuid, onutype))


async def onu_state(controller: Controller, credential: Credential | None, olt_ip, ponid, onuid, onutype="MAC"):
    return await call(controller, credential, lambda tl1: tl1.onu_state(olt_ip, ponid, onuid, onutype))


async def onu_optical(controller: Controller, credential: Credential | None, olt_ip, ponid, onuid, onutype="MAC"):
    return await call(controller, credential, lambda tl1: tl1.onu_optical(olt_ip, ponid, onuid, onutype))


async def onu_info(controller: Controller, credential: Credential | None, olt_ip, ponid, onuid, onutype="MAC"):
    return await call(controller, credential, lambda tl1: tl1.onu_info(olt_ip, ponid, onuid, onutype))


async def onu_lan(controller: Controller, credential: Credential | None, olt_ip, ponid, onuid, onutype="MAC"):
    return await call(controller, credential, lambda tl1: tl1.onu_lan(olt_ip, ponid, onuid, onutype))


async def onu_config(controller: Controller, credential: Credential | None, olt_ip, ponid, onuid, onutype="MAC"):
    return await call(controller, credential, lambda tl1: tl1.onu_config(olt_ip, ponid, onuid, onutype))


async def onu_wan(controller: Controller, credential: Credential | None, olt_ip, ponid, onuid, onutype="MAC"):
    return await call(controller, credential, lambda tl1: tl1.onu_wan(olt_ip, ponid, onuid, onutype))


async def onu_macaddress(controller: Controller, credential: Credential | None, olt_ip, ponid, onuid, onutype="MAC"):
    return await call(controller, credential, lambda tl1: tl1.onu_macaddress(olt_ip, ponid, onuid, onutype))


async def onu_laninfo(controller: Controller, credential: Credential | None, olt_ip, ponid, onuid, onutype="MAC"):
    return await call(controller, credential, lambda tl1: tl1.onu_laninfo(olt_ip, ponid, onuid, onutype))


async def onu_portvlan(
    controller: Controller, credential: Credential | None, olt_ip, ponid, onuid, onutype="MAC", onuport=None
):
    return await call(controller, credential, lambda tl1: tl1.onu_portvlan(olt_ip, ponid, onuid, onutype, onuport))


async def onu_service(controller: Controller, credential: Credential | None, olt_ip, ponid, onuid, onutype="MAC"):
    return await call(controller, credential, lambda tl1: tl1.onu_service_status(olt_ip, ponid, onuid, onutype))
