"""Varredura de rede: descobre RouterOS numa faixa de IPs.

Duas fases para ser rápido: (1) checa a porta SSH via TCP (timeout curto) em todos
os hosts; (2) só nos hosts com porta aberta, autentica por SSH e lê identity/resource.
Limitado (máx. de hosts) e com concorrência controlada.
"""

import asyncio
import ipaddress
import socket

from app.drivers import routeros

MAX_HOSTS = 512
CONCURRENCY = 48
TCP_TIMEOUT = 1.5


def parse_targets(spec: str) -> list[str]:
    """Aceita CIDR (192.168.88.0/24), range (192.168.88.1-254) ou IP único."""
    spec = (spec or "").strip()
    if not spec:
        return []
    if "/" in spec:
        net = ipaddress.ip_network(spec, strict=False)
        return [str(h) for h in net.hosts()]
    if "-" in spec and spec.count(".") == 3:
        base, _, last = spec.rpartition(".")
        lo, _, hi = last.partition("-")
        return [f"{base}.{i}" for i in range(int(lo), int(hi) + 1)]
    ipaddress.ip_address(spec)  # valida IP único
    return [spec]


def _tcp_open(host: str, port: int) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(TCP_TIMEOUT)
    try:
        return s.connect_ex((host, port)) == 0
    except OSError:
        return False
    finally:
        s.close()


def _probe(host: str, port: int, username: str, password: str) -> dict | None:
    from netmiko import ConnectHandler

    try:
        conn = ConnectHandler(
            device_type="mikrotik_routeros",
            host=host,
            port=port,
            username=username,
            password=password,
            conn_timeout=6,
            auth_timeout=8,
        )
    except Exception:
        return None  # não é RouterOS / auth falhou / sem resposta
    try:
        out = conn.send_command("/system identity print; /system resource print", read_timeout=15)
    except Exception:
        return None
    finally:
        try:
            conn.disconnect()
        except Exception:
            pass
    props = routeros.parse_props(out)
    return {
        "ip": host,
        "identity": props.get("name"),
        "version": props.get("version"),
        "board": props.get("board-name") or props.get("model"),
        "ssh_port": port,
    }


async def scan(spec: str, username: str, password: str, ssh_port: int) -> dict:
    targets = parse_targets(spec)
    if not targets:
        raise ValueError("faixa vazia ou inválida")
    if len(targets) > MAX_HOSTS:
        raise ValueError(f"faixa grande demais ({len(targets)} hosts; máx. {MAX_HOSTS})")

    sem = asyncio.Semaphore(CONCURRENCY)
    found: list[dict] = []

    async def probe_one(ip: str) -> None:
        async with sem:
            if not await asyncio.to_thread(_tcp_open, ip, ssh_port):
                return
            res = await asyncio.to_thread(_probe, ip, ssh_port, username, password)
            if res:
                found.append(res)

    await asyncio.gather(*(probe_one(ip) for ip in targets))
    found.sort(key=lambda r: tuple(int(o) for o in r["ip"].split(".")))
    return {"scanned": len(targets), "found": found}
