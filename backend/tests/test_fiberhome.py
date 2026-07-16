"""Testes do driver Fiberhome/UNM2000 (TL1) — listar OLTs e listar PONs.

Não tocam hardware: um socket TL1 falso (`FakeTL1Socket`) reproduz, byte a byte,
o formato de resposta tabular do UNM2000 (banner + blocos `total_blocks=N` +
separador de 80 hifens + cabeçalho/linhas separados por TAB) tal como os códigos
de exemplo (`fiberhome_tl1.py`). Exercita o caminho assíncrono completo do driver:
connect → LOGIN → comando de leitura → parse → LOGOUT.
"""

import socket
import time
import types

import pytest

from app.core.crypto import encrypt
from app.drivers import fiberhome
from app.drivers.base import DriverError

ISOLATE_BLOCK = "-" * 80


def _frame(total_blocks: int, header: list[str], rows: list[list[str]]) -> str:
    """Monta uma resposta TL1 tabular parseável por `return_records`.

    A linha de índice 4 (após split por '\\n' + strip) carrega `total_blocks=N`,
    seguida do separador de 80 hifens, do cabeçalho e das linhas (TAB), e termina
    em ';' — o terminador que `cmd()` usa para parar de ler.
    """
    lines = [
        "",                                # 0  eco/linha em branco
        "UNM2000 2026-06-23 10:00:00",     # 1  carimbo
        "M  CTAG COMPLD",                  # 2  status TL1
        "",                                # 3
        f"total_blocks={total_blocks}",    # 4  contagem de blocos
        ISOLATE_BLOCK,                     # 5  separador → próxima linha é o cabeçalho
        "\t".join(header),                 # 6  títulos das colunas
    ]
    lines += ["\t".join(r) for r in rows]  # 7+ dados
    lines.append(";")                      # terminador
    return "\n".join(lines)


# === Respostas canônicas (formato UNM2000) ===

LOGIN_OK = "\n".join(["", "", "UNM2000", "M  CTAG COMPLD", "ENDESC=No error", ";"])
LOGIN_FAIL = "\n".join(["", "", "UNM2000", "M  CTAG DENY", "ENDESC=Login failed", ";"])
LOGOUT_OK = "\n".join(["", "M  CTAG COMPLD", ";"])

OLTS = _frame(
    2,
    ["OLTID", "NAME", "NEIP", "DEVTYPE"],
    [
        ["1", "OLT_CENTRO", "10.0.0.1", "AN6000-17"],
        ["2", "OLT_NORTE", "10.0.0.2", "AN6000-07"],
    ],
)

PONS = _frame(
    3,
    ["PONID", "AUTHONUNUM", "ONLINEONUNUM", "PONRATE"],
    [
        ["NA-NA-1-1", "32", "30", "GPON"],
        ["NA-NA-1-2", "16", "12", "GPON"],
        ["NA-NA-1-3", "8", "8", "GPON"],
    ],
)

EMPTY = "\n".join(["", "UNM2000", "M  CTAG COMPLD", "", "total_blocks=0", ";"])
NOT_FOUND = "\n".join(["", "UNM2000", "M  CTAG DENY", "", "resource does not exist", ";"])


class FakeTL1Socket:
    """Socket falso que casa cada comando enviado com uma resposta roteirizada.

    Replica a semântica usada pelo driver: `connect`, um `recv(4096)` de banner e,
    por comando, `sendall` + `recv(1)` byte a byte até ';'. Quando o buffer esgota,
    levanta `socket.timeout` (igual ao hardware ocioso) para o laço de `cmd()` parar.
    """

    def __init__(self, routes: list[tuple[str, str]], default: str | None = None):
        self.routes = routes
        self.default = default
        self.sent: list[str] = []
        self._buf = b""
        self._timeout = None
        self._banner_done = False

    # --- API de socket usada pelo driver ---
    def settimeout(self, t):
        self._timeout = t

    def gettimeout(self):
        return self._timeout

    def connect(self, addr):
        self.addr = addr

    def sendall(self, data: bytes):
        cmd = data.decode("utf-8")
        self.sent.append(cmd.strip())
        for needle, resp in self.routes:
            if needle in cmd:
                self._buf = resp.encode("utf-8")
                return
        # default para comandos não roteirizados (ou ';' = bloco vazio terminado)
        self._buf = (self.default if self.default is not None else ";").encode("utf-8")

    def recv(self, n):
        if n == 4096 and not self._banner_done:
            self._banner_done = True
            return b">>> UNM2000 TL1 ready\n"
        if not self._buf:
            raise socket.timeout()
        chunk, self._buf = self._buf[:n], self._buf[n:]
        return chunk

    def close(self):
        pass


def _patch_socket(monkeypatch, sock: FakeTL1Socket) -> None:
    """Troca SÓ a referência de `socket` do driver — não a global.

    Patchear `socket.socket` no módulo global quebraria o self-pipe do event loop
    do asyncio (que também chama `socket.socket`). O driver usa `socket.socket`,
    `socket.AF_INET`, `socket.SOCK_STREAM` e `socket.timeout`; o shim repassa os
    três últimos ao módulo real e só intercepta a fábrica.
    """
    shim = types.SimpleNamespace(
        socket=lambda *a, **k: sock,
        AF_INET=socket.AF_INET,
        SOCK_STREAM=socket.SOCK_STREAM,
        timeout=socket.timeout,
    )
    monkeypatch.setattr(fiberhome, "socket", shim)
    # `cmd(sleep=...)` faz time.sleep real (até 8s em LST-ONU/LST-ONUSTATE em lote);
    # neutraliza para os testes não dormirem.
    monkeypatch.setattr(time, "sleep", lambda *a, **k: None)


@pytest.fixture
def fake_unm(monkeypatch):
    """Instala um UNM2000 falso e devolve o socket para inspeção dos comandos enviados.

    Uso: `sock = fake_unm([(needle, resposta), ...])`. LOGIN/LOGOUT já vêm prontos.
    """

    def install(routes: list[tuple[str, str]], default: str | None = None):
        sock = FakeTL1Socket([("LOGIN", LOGIN_OK), ("LOGOUT", LOGOUT_OK), *routes], default=default)
        _patch_socket(monkeypatch, sock)
        return sock

    return install


def _controller():
    return types.SimpleNamespace(host="172.16.0.10", port=3337)


def _credential(password: str = "admin123"):
    return types.SimpleNamespace(username="root", secret=encrypt(password))


# === Listar OLTs (LST-DEVICE) ===


async def test_list_olts_parseia_tabela(fake_unm):
    sock = fake_unm([("LST-DEVICE", OLTS)])

    olts = await fiberhome.list_olts(_controller(), _credential())

    assert [o["NAME"] for o in olts] == ["OLT_CENTRO", "OLT_NORTE"]
    assert olts[0] == {"OLTID": "1", "NAME": "OLT_CENTRO", "NEIP": "10.0.0.1", "DEVTYPE": "AN6000-17"}
    # Orquestração: logou, emitiu LST-DEVICE e deslogou.
    assert any(c.startswith("LOGIN:") for c in sock.sent)
    assert any("LST-DEVICE" in c for c in sock.sent)
    assert any(c.startswith("LOGOUT:") for c in sock.sent)


async def test_list_olts_vazio(fake_unm):
    fake_unm([("LST-DEVICE", EMPTY)])
    assert await fiberhome.list_olts(_controller(), _credential()) == []


async def test_auth_falha_vira_drivererror(monkeypatch):
    # LOGIN negado → DriverError, sem nunca chegar a consultar OLTs.
    sock = FakeTL1Socket([("LOGIN", LOGIN_FAIL), ("LOGOUT", LOGOUT_OK)])
    _patch_socket(monkeypatch, sock)

    with pytest.raises(DriverError):
        await fiberhome.list_olts(_controller(), _credential())

    assert not any("LST-DEVICE" in c for c in sock.sent)


async def test_sem_credencial_vira_drivererror():
    with pytest.raises(DriverError, match="credencial"):
        await fiberhome.list_olts(_controller(), None)


# === Listar PONs (LST-PONINFO) ===


async def test_list_pons_parseia_tabela(fake_unm):
    sock = fake_unm([("LST-PONINFO", PONS)])

    pons = await fiberhome.list_pons(_controller(), _credential(), olt_ip="10.0.0.1")

    assert [p["PONID"] for p in pons] == ["NA-NA-1-1", "NA-NA-1-2", "NA-NA-1-3"]
    assert pons[0]["AUTHONUNUM"] == "32"
    # O OLTID alvo entra no comando TL1.
    pon_cmd = next(c for c in sock.sent if "LST-PONINFO" in c)
    assert "OLTID=10.0.0.1" in pon_cmd
    assert "PONID=" not in pon_cmd  # sem ponid → consulta todas as PONs


async def test_list_pons_com_ponid_filtra(fake_unm):
    sock = fake_unm([("LST-PONINFO", PONS)])

    await fiberhome.list_pons(_controller(), _credential(), olt_ip="10.0.0.1", ponid="NA-NA-1-1")

    pon_cmd = next(c for c in sock.sent if "LST-PONINFO" in c)
    assert "OLTID=10.0.0.1" in pon_cmd
    assert "PONID=NA-NA-1-1" in pon_cmd


async def test_list_pons_recurso_inexistente(fake_unm):
    fake_unm([("LST-PONINFO", NOT_FOUND)])

    res = await fiberhome.list_pons(_controller(), _credential(), olt_ip="9.9.9.9")

    assert isinstance(res, dict)
    assert "resource does not exist" in res["error"]


# === Cobertura de TODAS as operações de leitura (verbo TL1 emitido + parse) ===

OLT = "10.0.0.1"
PON = "NA-NA-1-1"
ONU = "48575443A1B2"  # MAC/LOID de exemplo

GENERIC = _frame(1, ["COL1", "COL2"], [["v1", "v2"]])

# Cada caso: (rótulo, fábrica de coroutine, verbo TL1 esperado no comando enviado).
SIMPLE_OPS = [
    ("list_olts", lambda c, cr: fiberhome.list_olts(c, cr), "LST-DEVICE:::"),
    ("olt_info", lambda c, cr: fiberhome.olt_info(c, cr, OLT), "LST-DEVICE::OLTID=10.0.0.1"),
    ("olt_boards", lambda c, cr: fiberhome.olt_boards(c, cr, OLT), "LST-BOARD::OLTID=10.0.0.1"),
    ("olt_shelves", lambda c, cr: fiberhome.olt_shelves(c, cr, OLT), "LST-SHELF::OLTID=10.0.0.1"),
    ("list_pons", lambda c, cr: fiberhome.list_pons(c, cr, OLT), "LST-PONINFO::OLTID=10.0.0.1"),
    ("list_onus", lambda c, cr: fiberhome.list_onus(c, cr, OLT), "LST-ONU::OLTID=10.0.0.1"),
    ("onu_states", lambda c, cr: fiberhome.onu_states(c, cr, OLT), "LST-ONUSTATE::OLTID=10.0.0.1:CTAG"),
    ("onu_unregistered", lambda c, cr: fiberhome.onu_unregistered(c, cr, OLT), "LST-UNREGONU::OLTID=10.0.0.1"),
    ("onu_state", lambda c, cr: fiberhome.onu_state(c, cr, OLT, PON, ONU),
     f"LST-ONUSTATE::OLTID=10.0.0.1,PONID={PON},ONUIDTYPE=MAC,ONUID={ONU}"),
    ("onu_optical", lambda c, cr: fiberhome.onu_optical(c, cr, OLT, PON, ONU), "LST-OMDDM::OLTID=10.0.0.1"),
    ("onu_info", lambda c, cr: fiberhome.onu_info(c, cr, OLT, PON, ONU), "LST-DEVINFO::OLTID=10.0.0.1"),
    ("onu_lan", lambda c, cr: fiberhome.onu_lan(c, cr, OLT, PON, ONU), "LST-LANPORT::OLTID=10.0.0.1"),
    ("onu_config", lambda c, cr: fiberhome.onu_config(c, cr, OLT, PON, ONU), "LST-ONUCFG::OLTID=10.0.0.1"),
    ("onu_wan", lambda c, cr: fiberhome.onu_wan(c, cr, OLT, PON, ONU), "LST-ONUWANSERVICECFG::OLTID=10.0.0.1"),
    ("onu_macaddress", lambda c, cr: fiberhome.onu_macaddress(c, cr, OLT, PON, ONU), "LST-ONUMACADDRESS::OLTID=10.0.0.1"),
    ("onu_laninfo", lambda c, cr: fiberhome.onu_laninfo(c, cr, OLT, PON, ONU), "LST-ONULANINFO::OLTID=10.0.0.1"),
    ("onu_portvlan", lambda c, cr: fiberhome.onu_portvlan(c, cr, OLT, PON, ONU), "LST-PORTVLAN::OLTID=10.0.0.1"),
    ("onu_service", lambda c, cr: fiberhome.onu_service(c, cr, OLT, PON, ONU), "LST-ONUSERVICESTATUS::OLTID=10.0.0.1"),
]


@pytest.mark.parametrize("label,factory,verb", SIMPLE_OPS, ids=[op[0] for op in SIMPLE_OPS])
async def test_operacao_emite_verbo_e_parseia(fake_unm, label, factory, verb):
    sock = fake_unm([], default=GENERIC)

    result = await factory(_controller(), _credential())

    # Parse tabular padrão → lista de registros.
    assert result == [{"COL1": "v1", "COL2": "v2"}]
    # O verbo TL1 correto foi enviado ao UNM2000.
    assert any(verb in c for c in sock.sent), f"{label}: verbo {verb!r} não enviado; enviados={sock.sent}"


async def test_onu_portvlan_inclui_onuport(fake_unm):
    sock = fake_unm([], default=GENERIC)

    await fiberhome.onu_portvlan(_controller(), _credential(), OLT, PON, ONU, onuport="NA-NA-NA-1")

    cmd = next(c for c in sock.sent if "LST-PORTVLAN" in c)
    assert "ONUPORT=NA-NA-NA-1" in cmd


# === Localizar ONU (QUERY-ONUINFO + consolidação) ===

QUERY_ONU = _frame(1, ["ONUID", "SlotNo", "PonNo", "ONUNO"], [[ONU, "2", "3", "5"]])


async def test_localizar_onu_consolida_e_resolve_ponid(fake_unm):
    # QUERY-ONUINFO devolve slot/pon; as sub-consultas usam o default genérico.
    sock = fake_unm([("QUERY-ONUINFO", QUERY_ONU)], default=GENERIC)

    res = await fiberhome.locate_onu(_controller(), _credential(), OLT, ONU)

    assert isinstance(res, dict)
    assert set(res) == {"query", "state", "optical", "info", "lan_port", "config", "macaddress", "lan_info"}
    assert res["query"] == [{"ONUID": ONU, "SlotNo": "2", "PonNo": "3", "ONUNO": "5"}]
    # PONID derivado de slot/pon (NA-NA-{slot}-{pon}) entra nas sub-consultas.
    assert any("PONID=NA-NA-2-3" in c for c in sock.sent)
    # Consolidou as 6 leituras de detalhe (estado, sinal, info, lan, config, mac, laninfo).
    for verb in ("LST-ONUSTATE", "LST-OMDDM", "LST-DEVINFO", "LST-LANPORT", "LST-ONUCFG", "LST-ONUMACADDRESS", "LST-ONULANINFO"):
        assert any(verb in c for c in sock.sent)


async def test_localizar_onu_inexistente_propaga_erro(fake_unm):
    fake_unm([("QUERY-ONUINFO", NOT_FOUND)], default=GENERIC)

    res = await fiberhome.locate_onu(_controller(), _credential(), OLT, "0000DEADBEEF")

    assert isinstance(res, dict)
    assert "error" in res and "resource does not exist" in res["error"]


# === Alarmes (QUERY-ALARM — retorno bruto, não tabular) ===

ALARM_RAW = "\n".join(
    ["", "UNM2000", "M  CTAG COMPLD", "", "total_blocks=1", ISOLATE_BLOCK, "FAULTNAME\tLEVEL", "LOS\tCritical", ";"]
)


async def test_alarmes_envia_query_alarm(fake_unm):
    sock = fake_unm([("QUERY-ALARM", ALARM_RAW)])

    res = await fiberhome.olt_alarms(_controller(), _credential(), OLT, start="2026-06-23 00:00:00")

    # olt_alarms devolve as linhas brutas do TL1 (não passa por return_records).
    assert isinstance(res, list)
    assert any("FAULTNAME" in line for line in res)
    cmd = next(c for c in sock.sent if "QUERY-ALARM" in c)
    assert "FAULTFLAG=ALL" in cmd
    assert "BEGINTIME=2026-06-23 00:00:00" in cmd
