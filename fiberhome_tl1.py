#!/usr/bin/env python3
"""
Fiberhome OLT management via TL1 commands through UNM2000.
Ported from PHP Fiberhome class.

Usage:
  python3 fiberhome_tl1.py --list-olts
  python3 fiberhome_tl1.py --olt <nome_ou_ip> --action <ação>
  python3 fiberhome_tl1.py --raw "<TL1 command>"

Actions:
  olts              List all OLTs (LST-DEVICE)
  olt-info          OLT info
  boards            List boards (LST-BOARD)
  shelves           List shelves (LST-SHELF)
  pon-info          PON info (optional --ponid)
  onus              List ONUs (optional --ponid)
  onu-state         ONU state (requires --onuid)
  onu-optical       ONU optical info / OMDDM (requires --onuid)
  onu-info          ONU device info (requires --onuid)
  onu-query         Full ONU query (requires --onuid)
  onu-lan           ONU LAN ports (requires --onuid)
  onu-config        ONU config (requires --onuid)
  onu-wan           ONU WAN services (requires --onuid)
  onu-macaddress    ONU MAC address table (requires --onuid)
  onu-laninfo       ONU LAN info (requires --onuid)
  onu-portvlan      ONU port VLAN (requires --onuid, optional --onuport)
  onu-service       ONU service status (requires --onuid)
  unregistered      Unregistered ONUs
  alarms            OLT alarms (requires --start, --end)
  cmd               Raw TL1 command (use --command)
"""

import argparse
import json
import socket
import sys
import time

from fiberhome_config import get_inventory_path, load_config

ISOLATE_BLOCK = "-" * 80


def load_inventory(inventory_path=None):
    return load_config(inventory_path)


def find_olt(inventory, identifier):
    identifier_lower = identifier.lower()
    for olt in inventory["olts"]:
        if olt["nome"].lower() == identifier_lower or olt["ip"] == identifier:
            return olt
    return None


class FiberhomeTL1:
    def __init__(self, host, port=3337, timeout=30):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.sock = None

    def connect(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        print(f">>> Conectando ao UNM2000 ({self.host}:{self.port})...", file=sys.stderr)
        self.sock.connect((self.host, self.port))
        # Read banner
        time.sleep(1)
        try:
            banner = self.sock.recv(4096).decode("utf-8", errors="replace")
            if banner.strip():
                print(f">>> Banner: {banner.strip()}", file=sys.stderr)
        except socket.timeout:
            pass

    def login(self, username, password):
        ret = self.cmd(f"LOGIN:::CTAG::UN={username},PWD={password};")
        if self._cmd_ok(ret):
            print(">>> Autenticação OK", file=sys.stderr)
            return True
        else:
            raise Exception(f"Falha na autenticação: {ret[4] if len(ret) > 4 else ret}")

    def logout(self):
        try:
            self.cmd("LOGOUT:::CTAG::;")
        except Exception:
            pass
        if self.sock:
            self.sock.close()

    def cmd(self, command, sleep=None):
        """Send TL1 command and read response until ';'."""
        self.sock.sendall((command + "\n").encode("utf-8"))
        if sleep and sleep > 0:
            time.sleep(sleep)

        buffer = ""
        while True:
            try:
                c = self.sock.recv(1).decode("utf-8", errors="replace")
                buffer += c
                if c == ";":
                    break
            except socket.timeout:
                break

        ret = [line.strip() for line in buffer.split("\n")]
        return ret

    def _cmd_ok(self, ret):
        if len(ret) > 4 and "ENDESC=No error" in ret[4]:
            return True
        return False

    def return_records(self, raw_list):
        """Parse TL1 tabular response into list of dicts."""
        if len(raw_list) <= 4:
            return {"error": "Resposta vazia ou incompleta", "raw": raw_list}

        line4 = raw_list[4] if len(raw_list) > 4 else ""
        if "resource does not exist" in line4 or "invalid parameter format" in line4:
            return {"error": line4, "raw": raw_list}

        # Parse total_blocks
        try:
            tmp = raw_list[4].split("=")
            total_blocks = int(tmp[1]) if len(tmp) > 1 else 0
        except (IndexError, ValueError):
            return {"error": "Não foi possível parsear resposta", "raw": raw_list}

        if total_blocks == 0:
            return []

        records_all = []
        titles = []
        in_table = False

        for line_idx, line in enumerate(raw_list):
            if not line or line == ";":
                continue

            if line == ISOLATE_BLOCK:
                if line_idx + 1 < len(raw_list):
                    titles = [title.strip() for title in raw_list[line_idx + 1].split("\t") if title.strip()]
                    in_table = bool(titles)
                continue

            if not in_table:
                continue

            # Skip the title line immediately after each separator.
            if line.split("\t") == titles:
                continue

            # Metadata for the next TL1 block starts after the current table.
            if "\t" not in line and (
                line.startswith(">")
                or line.startswith("M ")
                or "=" in line
                or line.startswith("List of ")
            ):
                in_table = False
                continue

            values = line.split("\t")
            if len(values) < len(titles):
                continue

            record = {}
            for idx, title in enumerate(titles):
                record[title] = values[idx].strip() if idx < len(values) else ""
            if record and record != {title: title for title in titles}:
                records_all.append(record)

        if not records_all and not titles:
            return {"error": "Formato de resposta não reconhecido", "raw": raw_list}

        return records_all

    # === High-level commands ===

    def list_devices(self):
        return self.return_records(self.cmd("LST-DEVICE:::CTAG::;"))

    def olt_info(self, olt_ip):
        return self.return_records(self.cmd(f"LST-DEVICE::OLTID={olt_ip}:CTAG::;"))

    def olt_boards(self, olt_ip):
        return self.return_records(self.cmd(f"LST-BOARD::OLTID={olt_ip}:CTAG::;"))

    def olt_shelves(self, olt_ip):
        return self.return_records(self.cmd(f"LST-SHELF::OLTID={olt_ip}:CTAG::;"))

    def olt_poninfo(self, olt_ip, ponid=None):
        if ponid:
            return self.return_records(self.cmd(f"LST-PONINFO::OLTID={olt_ip},PONID={ponid}:CTAG::;"))
        return self.return_records(self.cmd(f"LST-PONINFO::OLTID={olt_ip}:CTAG::;"))

    def onu_list(self, olt_ip, ponid=None):
        old_timeout = self.sock.gettimeout()
        self.sock.settimeout(120)
        try:
            if ponid:
                return self.return_records(self.cmd(f"LST-ONU::OLTID={olt_ip},PONID={ponid}:CTAG::;", sleep=4))
            return self.return_records(self.cmd(f"LST-ONU::OLTID={olt_ip}:CTAG::;", sleep=8))
        finally:
            self.sock.settimeout(old_timeout)

    def onu_state_bulk(self, olt_ip):
        """Returns AdminState/OperState/LASTOFFTIME for all ONUs on an OLT.
        Correlate by AUTHINFO (MAC address)."""
        old_timeout = self.sock.gettimeout()
        self.sock.settimeout(120)
        try:
            return self.return_records(self.cmd(f"LST-ONUSTATE::OLTID={olt_ip}:CTAG::;", sleep=8))
        finally:
            self.sock.settimeout(old_timeout)

    def onu_state(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(self.cmd(f"LST-ONUSTATE::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))

    def onu_optical(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(self.cmd(f"LST-OMDDM::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))

    def onu_info(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(self.cmd(f"LST-DEVINFO::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))

    def onu_query(self, olt_ip, onuid, onutype="MAC"):
        """Full ONU query — fetches state, optical, info, lan, config, mac."""
        query = self.return_records(self.cmd(f"QUERY-ONUINFO::OLTID={olt_ip},ONUID={onuid},ONUIDTYPE={onutype}:CTAG::;"))
        if isinstance(query, dict) and "error" in query:
            return query

        record = query[0] if isinstance(query, list) and query else {}
        slot = record.get("SlotNo", "")
        pon = record.get("PonNo", "")
        ponid = f"NA-NA-{slot}-{pon}"

        result = {"query": query}
        result["state"] = self.return_records(self.cmd(f"LST-ONUSTATE::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))
        result["optical"] = self.return_records(self.cmd(f"LST-OMDDM::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))
        result["info"] = self.return_records(self.cmd(f"LST-DEVINFO::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))
        result["lan_port"] = self.return_records(self.cmd(f"LST-LANPORT::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))
        result["config"] = self.return_records(self.cmd(f"LST-ONUCFG::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))
        result["macaddress"] = self.return_records(self.cmd(f"LST-ONUMACADDRESS::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))
        result["lan_info"] = self.return_records(self.cmd(f"LST-ONULANINFO::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))
        return result

    def onu_lan(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(self.cmd(f"LST-LANPORT::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))

    def onu_config(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(self.cmd(f"LST-ONUCFG::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))

    def onu_wan(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(self.cmd(f"LST-ONUWANSERVICECFG::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))

    def onu_macaddress(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(self.cmd(f"LST-ONUMACADDRESS::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))

    def onu_laninfo(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(self.cmd(f"LST-ONULANINFO::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))

    def onu_portvlan(self, olt_ip, ponid, onuid, onutype="MAC", onuport=None):
        if onuport:
            return self.return_records(self.cmd(f"LST-PORTVLAN::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid},ONUPORT={onuport}:CTAG::;"))
        return self.return_records(self.cmd(f"LST-PORTVLAN::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))

    def onu_service_status(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(self.cmd(f"LST-ONUSERVICESTATUS::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))

    def onu_unregistered(self, olt_ip):
        return self.return_records(self.cmd(f"LST-UNREGONU::OLTID={olt_ip}:CTAG::;"))

    def olt_alarms(self, olt_ip, start, end=None):
        cmd = f"QUERY-ALARM::OLTID={olt_ip}:CTAG::BEGINTIME={start},FAULTFLAG=ALL;"
        return self.cmd(cmd)

    # === Write commands (require confirmation) ===

    def onu_reset(self, olt_ip, ponid, onuid, onutype="MAC"):
        return self.return_records(self.cmd(f"RESET-ONU::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::;"))

    def onu_add(self, olt_ip, ponid, authtype, onuid, name, onutype="AN5506-01-A1"):
        ret = self.cmd(f"ADD-ONU::OLTID={olt_ip},PONID={ponid}:CTAG::AUTHTYPE={authtype},ONUID={onuid},NAME={name},DESC={name},ONUTYPE={onutype};")
        return self._cmd_ok(ret), ret

    def onu_del(self, olt_ip, ponid, onuid, onutype="MAC"):
        ret = self.cmd(f"DEL-ONU::OLTID={olt_ip},PONID={ponid}:CTAG::ONUIDTYPE={onutype},ONUID={onuid};")
        return self._cmd_ok(ret), ret

    def cfg_lanport(self, olt_ip, ponid, onuid, onuport, configs, onutype="MAC"):
        cfg = ",".join(f"{k}={v}" for k, v in configs.items())
        ret = self.cmd(f"CFG-LANPORT::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid},ONUPORT={onuport}:CTAG::{cfg};")
        return self._cmd_ok(ret), ret

    def cfg_lanportvlan(self, olt_ip, ponid, onuid, onuport, configs, onutype="MAC"):
        cfg = ",".join(f"{k}={v}" for k, v in configs.items())
        ret = self.cmd(f"CFG-LANPORTVLAN::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid},ONUPORT={onuport}:CTAG::{cfg};")
        return self._cmd_ok(ret), ret

    def set_wanservice(self, olt_ip, ponid, onuid, status, configs, onutype="MAC"):
        cfg = ",".join(f"{k}={v}" for k, v in configs.items())
        ret = self.cmd(f"SET-WANSERVICE::OLTID={olt_ip},PONID={ponid},ONUIDTYPE={onutype},ONUID={onuid}:CTAG::STATUS={status},{cfg};")
        return self._cmd_ok(ret), ret


def format_output(data):
    """Pretty-print results."""
    if isinstance(data, dict) and "error" in data:
        print(f"ERRO: {data['error']}")
        return
    if isinstance(data, list):
        if not data:
            print("(sem registros)")
            return
        if isinstance(data[0], dict):
            # Print as table
            keys = list(data[0].keys())
            print("\t".join(keys))
            print("-" * 80)
            for row in data:
                print("\t".join(str(row.get(k, "")) for k in keys))
            print(f"\nTotal: {len(data)} registro(s)")
        else:
            for item in data:
                print(item)
    elif isinstance(data, dict):
        # onu-query returns nested dict
        for section, records in data.items():
            print(f"\n=== {section.upper()} ===")
            format_output(records)
    else:
        print(data)


def main():
    parser = argparse.ArgumentParser(description="Fiberhome TL1 via UNM2000")
    parser.add_argument("--olt", help="OLT name or IP from inventory")
    parser.add_argument("--action", help="Action to perform")
    parser.add_argument("--command", help="Raw TL1 command")
    parser.add_argument("--raw", help="Raw TL1 command (alias)")
    parser.add_argument("--ponid", help="PON ID (e.g. NA-NA-11-1)")
    parser.add_argument("--onuid", help="ONU ID (MAC or LOID)")
    parser.add_argument("--onutype", default="MAC", help="ONU ID type (MAC/LOID)")
    parser.add_argument("--onuport", help="ONU port (e.g. NA-NA-NA-1)")
    parser.add_argument("--start", help="Alarm start time")
    parser.add_argument("--end", help="Alarm end time")
    parser.add_argument("--list-olts", action="store_true")
    parser.add_argument("--inventory", default=None)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--json", action="store_true", help="Output as JSON")

    args = parser.parse_args()

    inv_path = args.inventory or get_inventory_path()
    inventory = load_inventory(inv_path)

    if args.list_olts:
        print("=== OLTs Fiberhome Cadastradas ===")
        print(f"UNM2000: {inventory['unm2000']['ip']}:{inventory['unm2000']['porta']}")
        print()
        for olt in inventory["olts"]:
            print(f"  - {olt['nome']} | IP: {olt['ip']} | Modelo: {olt.get('modelo', 'N/A')} | PON: {olt.get('slot_pon', 'N/A')}")
        return 0

    # Resolve OLT
    olt_ip = None
    if args.olt:
        olt_info = find_olt(inventory, args.olt)
        if olt_info:
            olt_ip = olt_info["ip"]
            print(f">>> OLT: {olt_info['nome']} ({olt_ip}) - {olt_info.get('modelo', 'N/A')}", file=sys.stderr)
        else:
            # Treat as direct IP
            olt_ip = args.olt
            print(f">>> OLT (direto): {olt_ip}", file=sys.stderr)

    raw_cmd = args.raw or args.command
    action = args.action or ("cmd" if raw_cmd else None)

    if not action:
        print("ERRO: Especifique --action ou --raw/--command", file=sys.stderr)
        return 1

    actions_require_olt = {
        "olt-info",
        "boards",
        "shelves",
        "pon-info",
        "onus",
        "onu-state",
        "onu-optical",
        "onu-info",
        "onu-query",
        "onu-lan",
        "onu-config",
        "onu-wan",
        "onu-macaddress",
        "onu-laninfo",
        "onu-portvlan",
        "onu-service",
        "unregistered",
        "alarms",
    }
    actions_require_onu = {
        "onu-state",
        "onu-optical",
        "onu-info",
        "onu-query",
        "onu-lan",
        "onu-config",
        "onu-wan",
        "onu-macaddress",
        "onu-laninfo",
        "onu-portvlan",
        "onu-service",
    }
    actions_require_pon = actions_require_onu - {"onu-query"}

    if action in actions_require_olt and not olt_ip:
        print("ERRO: informe --olt para esta ação", file=sys.stderr)
        return 1
    if action in actions_require_onu and not args.onuid:
        print("ERRO: informe --onuid para esta ação", file=sys.stderr)
        return 1
    if action in actions_require_pon and not args.ponid:
        print(
            "ERRO: informe --ponid para esta ação. Exemplo: --ponid 1-1-11-1",
            file=sys.stderr,
        )
        return 1

    # Connect
    unm = inventory["unm2000"]
    tl1 = FiberhomeTL1(unm["ip"], unm["porta"], args.timeout)

    try:
        tl1.connect()
        tl1.login(unm["usuario"], unm["senha"])
    except Exception as e:
        print(f"ERRO: {e}", file=sys.stderr)
        return 1

    try:

        result = None

        if action == "cmd" and raw_cmd:
            print(f">>> Executando: {raw_cmd}", file=sys.stderr)
            raw_result = tl1.cmd(raw_cmd)
            parsed = tl1.return_records(raw_result)
            result = parsed if not isinstance(parsed, dict) or "error" not in parsed else raw_result
        elif action == "olts":
            result = tl1.list_devices()
        elif action == "olt-info":
            result = tl1.olt_info(olt_ip)
        elif action == "boards":
            result = tl1.olt_boards(olt_ip)
        elif action == "shelves":
            result = tl1.olt_shelves(olt_ip)
        elif action == "pon-info":
            result = tl1.olt_poninfo(olt_ip, args.ponid)
        elif action == "onus":
            result = tl1.onu_list(olt_ip, args.ponid)
        elif action == "onu-state":
            result = tl1.onu_state(olt_ip, args.ponid, args.onuid, args.onutype)
        elif action == "onu-optical":
            result = tl1.onu_optical(olt_ip, args.ponid, args.onuid, args.onutype)
        elif action == "onu-info":
            result = tl1.onu_info(olt_ip, args.ponid, args.onuid, args.onutype)
        elif action == "onu-query":
            result = tl1.onu_query(olt_ip, args.onuid, args.onutype)
        elif action == "onu-lan":
            result = tl1.onu_lan(olt_ip, args.ponid, args.onuid, args.onutype)
        elif action == "onu-config":
            result = tl1.onu_config(olt_ip, args.ponid, args.onuid, args.onutype)
        elif action == "onu-wan":
            result = tl1.onu_wan(olt_ip, args.ponid, args.onuid, args.onutype)
        elif action == "onu-macaddress":
            result = tl1.onu_macaddress(olt_ip, args.ponid, args.onuid, args.onutype)
        elif action == "onu-laninfo":
            result = tl1.onu_laninfo(olt_ip, args.ponid, args.onuid, args.onutype)
        elif action == "onu-portvlan":
            result = tl1.onu_portvlan(olt_ip, args.ponid, args.onuid, args.onutype, args.onuport)
        elif action == "onu-service":
            result = tl1.onu_service_status(olt_ip, args.ponid, args.onuid, args.onutype)
        elif action == "unregistered":
            result = tl1.onu_unregistered(olt_ip)
        elif action == "alarms":
            result = tl1.olt_alarms(olt_ip, args.start, args.end)
        else:
            print(f"ERRO: Ação desconhecida: {action}", file=sys.stderr)
            return 1

        if args.json:
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            format_output(result)

    except Exception as e:
        print(f"ERRO: {e}", file=sys.stderr)
        return 1
    finally:
        tl1.logout()

    return 0


if __name__ == "__main__":
    sys.exit(main())
