"""Leitura RouterOS via CLI (SSH/Telnet) — parsing da saída de `print`.

Tudo aqui é SOMENTE LEITURA (comandos `...print`), classificados como `read`
pelo classifier e auditados pelo runner. Dois formatos de saída do RouterOS:

* `print`        → blocos verticais `chave: valor` (recursos de item único).
* `print terse`  → 1 registro por linha: `<id> [flags] chave=valor ...`.
"""

import re

# === Comandos de leitura (read-only) ===

# Recursos de item único (formato vertical "chave: valor").
CMD_RESOURCE_BOARD = "/system resource print; /system routerboard print"
CMD_HEALTH = "/system health print terse without-paging"

# Tabelas (formato terse, 1 registro por linha).
CMD_INTERFACES = "/interface print terse without-paging"
CMD_FW_FILTER = "/ip firewall filter print terse without-paging"
CMD_FW_NAT = "/ip firewall nat print terse without-paging"
CMD_DHCP_SERVERS = "/ip dhcp-server print terse without-paging"
CMD_DHCP_LEASES = "/ip dhcp-server lease print terse without-paging"
CMD_ROUTES = "/ip route print terse without-paging"
CMD_SERVICES = "/ip service print terse without-paging"
CMD_NEIGHBORS = "/ip neighbor print terse without-paging"
CMD_IP_ADDRESSES = "/ip address print terse without-paging"
CMD_DHCP_CLIENT = "/ip dhcp-client print terse without-paging"
CMD_LOGS = "/log print terse without-paging"
CMD_USERS = "/user print terse without-paging"


def _tokenize(s: str) -> list[str]:
    """Divide por espaços respeitando aspas duplas (valores como comment="a b")."""
    tokens: list[str] = []
    cur = ""
    in_quote = False
    for ch in s:
        if ch == '"':
            in_quote = not in_quote
            cur += ch
        elif ch == " " and not in_quote:
            if cur:
                tokens.append(cur)
                cur = ""
        else:
            cur += ch
    if cur:
        tokens.append(cur)
    return tokens


def _unquote(v: str) -> str:
    if len(v) >= 2 and v.startswith('"') and v.endswith('"'):
        return v[1:-1]
    return v


def parse_terse(output: str) -> list[dict]:
    """Parseia `print terse` em uma lista de dicts (com `#` e `flags`)."""
    records: list[dict] = []
    for raw in (output or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        idx = ""
        rest = line
        # Linha de dado começa com o índice numérico do item.
        head, sep, tail = line.partition(" ")
        if head.isdigit():
            idx = head
            rest = tail.strip()
        elif "=" not in line:
            # Legenda ("Flags: X - disabled, ...") ou cabeçalho — ignora.
            continue

        flags: list[str] = []
        fields: dict[str, str] = {}
        last_key: str | None = None
        for tok in _tokenize(rest):
            if "=" in tok:
                k, _, v = tok.partition("=")
                fields[k] = _unquote(v)
                last_key = k
            elif last_key is None:
                # tokens iniciais (antes do 1º chave=valor) = flags (R, X, S, ...)
                if re.fullmatch(r"[A-Za-z]+", tok):
                    flags.append(tok)
            else:
                # token solto após um valor = continuação de valor com espaço (sem aspas)
                fields[last_key] = f"{fields[last_key]} {tok}".strip()

        rec: dict[str, str] = {"#": idx}
        if flags:
            rec["flags"] = "".join(flags)
        rec.update(fields)
        if len(rec) > 1:  # além do "#"
            records.append(rec)
    return records


def wan_interfaces(routes: list[dict], addresses: list[dict], dhcp_clients: list[dict]) -> list[str]:
    """Deduz as interfaces WAN: interface do dhcp-client + interface da rota default.

    Para rota default com gateway por IP, resolve a interface cuja rede contém o gateway.
    """
    import ipaddress

    wan: set[str] = set()

    for c in dhcp_clients:
        iface = c.get("interface")
        if iface:
            wan.add(iface)

    for r in routes:
        if r.get("dst-address") != "0.0.0.0/0":
            continue
        gw = r.get("gateway") or ""
        for part in (p.strip() for p in gw.split(",") if p.strip()):
            if "%" in part:  # formato "10.0.0.1%ether1"
                wan.add(part.split("%", 1)[1])
                continue
            try:
                gwip = ipaddress.ip_address(part)
            except ValueError:
                wan.add(part)  # gateway é o próprio nome da interface
                continue
            for a in addresses:
                addr = a.get("address") or ""
                if "/" not in addr or not a.get("interface"):
                    continue
                try:
                    net = ipaddress.ip_interface(addr).network
                except ValueError:
                    continue
                if gwip in net:
                    wan.add(a["interface"])
    return sorted(wan)


def parse_logs(output: str) -> list[dict]:
    """Parseia `/log print terse` (colunar: `[data] hora topics mensagem`)."""
    logs: list[dict] = []
    for raw in (output or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        toks = line.split()
        if len(toks) < 2:
            continue
        # tempo: 1 token (hora "13:18:53") ou 2 tokens (data + hora)
        if ":" in toks[0]:
            time_, idx = toks[0], 1
        else:
            time_, idx = f"{toks[0]} {toks[1]}", 2
        if idx >= len(toks):
            continue
        logs.append({"time": time_, "topics": toks[idx], "message": " ".join(toks[idx + 1 :])})
    return logs


def parse_props(output: str) -> dict:
    """Parseia blocos verticais `chave: valor` em um único dict."""
    props: dict[str, str] = {}
    for raw in (output or "").splitlines():
        line = raw.strip()
        if not line or ":" not in line:
            continue
        k, _, v = line.partition(":")
        k = k.strip()
        v = v.strip()
        if k and k not in props:  # 1ª ocorrência vence (evita ruído de blocos repetidos)
            props[k] = v
    return props


def health_temperature(output: str) -> str | None:
    """Extrai a temperatura (°C) da saída de `/system health print terse`."""
    for rec in parse_terse(output):
        name = (rec.get("name") or "").lower()
        if name in ("temperature", "cpu-temperature", "board-temperature"):
            return rec.get("value")
    return None


def summarize_system(props: dict, temperature: str | None) -> dict:
    """Resumo amigável para os cards do detalhe (CPU/RAM/temp/uptime + identidade)."""
    free = _to_bytes(props.get("free-memory"))
    total = _to_bytes(props.get("total-memory"))
    used_pct = None
    if free is not None and total:
        used_pct = round((total - free) / total * 100)
    return {
        "cpu_load": (props.get("cpu-load") or "").rstrip("%") or None,
        "ram_used_pct": used_pct,
        "free_memory": free,
        "total_memory": total,
        "temperature": temperature,
        "uptime": props.get("uptime"),
        "version": props.get("version"),
        "board": props.get("model") or props.get("board-name"),
        # board-name de "/system resource" (espaços → "-"): usado p/ escolher a imagem do device.
        "board_name": (props.get("board-name") or "").replace(" ", "-") or None,
        "architecture": props.get("architecture-name"),
        "serial": props.get("serial-number"),
        "current_firmware": props.get("current-firmware"),
        "upgrade_firmware": props.get("upgrade-firmware"),
    }


_UNITS = {
    "": 1, "B": 1,
    "KiB": 1024, "MiB": 1024**2, "GiB": 1024**3, "TiB": 1024**4,
    "KB": 1000, "MB": 1000**2, "GB": 1000**3, "TB": 1000**4,
}


_BPS_UNITS = {"": 1, "bps": 1, "kbps": 1e3, "Mbps": 1e6, "Gbps": 1e9, "Tbps": 1e12}


def parse_bps(v: str | None) -> int:
    """Taxa do RouterOS ('7.3kbps', '1.0Mbps', '0') em bits/s (decimal). 0 se ausente."""
    if not v:
        return 0
    m = re.match(r"^([\d.]+)\s*([A-Za-z]*)$", v.strip())
    if not m:
        return 0
    mult = _BPS_UNITS.get(m.group(2))
    return int(float(m.group(1)) * mult) if mult is not None else 0


def _to_bytes(v: str | None) -> int | None:
    """Converte memória do RouterOS em bytes. Aceita inteiro puro ou '324.4MiB'."""
    if not v:
        return None
    m = re.match(r"^([\d.]+)\s*([A-Za-z]*)$", v.strip())
    if not m:
        return None
    mult = _UNITS.get(m.group(2))
    if mult is None:
        return None
    return int(float(m.group(1)) * mult)
