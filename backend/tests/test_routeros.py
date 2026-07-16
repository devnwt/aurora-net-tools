"""Testes do parser RouterOS (drivers/routeros.py) — terse, props e resumo."""

from app.drivers import routeros

FW_FILTER = """Flags: X - disabled, I - invalid, D - dynamic
 0    chain=input action=accept connection-state=established,related,untracked log=no log-prefix=""
 1    chain=input action=drop comment="drop all from wan" in-interface=ether1
 2 X  chain=forward action=accept protocol=tcp dst-port=80
"""

RESOURCE_BOARD = """
                   uptime: 5d21h44m
                  version: 7.23.1 (stable)
                 cpu-load: 1%
              free-memory: 100000
             total-memory: 256000
        architecture-name: arm
                    model: L009UiGS-2HaxD
            serial-number: ABC123
         current-firmware: 7.23.1
         upgrade-firmware: 7.23.1
"""

HEALTH = """ 0 name=temperature value=35 type=C
 1 name=cpu-temperature value=36 type=C
"""


def test_parse_terse_fields_and_flags():
    rules = routeros.parse_terse(FW_FILTER)
    assert len(rules) == 3
    assert rules[0]["chain"] == "input"
    assert rules[0]["action"] == "accept"
    # comentário com espaços (entre aspas) é preservado e desaspado
    assert rules[1]["comment"] == "drop all from wan"
    assert rules[1]["in-interface"] == "ether1"
    # flag X (disabled) capturada
    assert rules[2]["flags"] == "X"
    assert rules[2]["dst-port"] == "80"
    # a legenda "Flags: ..." não vira registro
    assert all(r["chain"] for r in rules)


def test_parse_terse_valor_com_espaco_sem_aspas():
    # datetime sem aspas (RouterOS) não pode poluir os flags nem quebrar o registro
    line = " 0 R  name=ether1 type=ether last-link-up-time=2026-06-23 14:58:07 link-downs=0"
    rec = routeros.parse_terse(line)[0]
    assert rec["flags"] == "R"
    assert rec["name"] == "ether1"
    assert rec["last-link-up-time"] == "2026-06-23 14:58:07"
    assert rec["link-downs"] == "0"


def test_parse_terse_ignora_legenda_e_vazias():
    assert routeros.parse_terse("") == []
    assert routeros.parse_terse("Flags: X - disabled\n\n") == []


def test_parse_props():
    props = routeros.parse_props(RESOURCE_BOARD)
    assert props["version"] == "7.23.1 (stable)"
    assert props["model"] == "L009UiGS-2HaxD"
    assert props["cpu-load"] == "1%"


def test_parse_logs():
    out = (
        "2026-07-04 13:18:53 system,info,account user noc logged in from 10.9.9.28 via ssh\n"
        " 13:19:00 system,error dhcp alert on bridge\n"
        "\n"
    )
    logs = routeros.parse_logs(out)
    assert len(logs) == 2
    assert logs[0]["time"] == "2026-07-04 13:18:53"
    assert logs[0]["topics"] == "system,info,account"
    assert logs[0]["message"] == "user noc logged in from 10.9.9.28 via ssh"
    # linha só com hora (sem data)
    assert logs[1]["time"] == "13:19:00"
    assert logs[1]["topics"] == "system,error"
    assert logs[1]["message"] == "dhcp alert on bridge"


def test_health_temperature():
    assert routeros.health_temperature(HEALTH) == "35"
    assert routeros.health_temperature("") is None


def test_summarize_system():
    props = routeros.parse_props(RESOURCE_BOARD)
    s = routeros.summarize_system(props, temperature="35")
    assert s["cpu_load"] == "1"
    assert s["ram_used_pct"] == 61  # (256000-100000)/256000 ≈ 60.9 → 61
    assert s["board"] == "L009UiGS-2HaxD"
    assert s["version"] == "7.23.1 (stable)"
    assert s["temperature"] == "35"
    assert s["uptime"] == "5d21h44m"
    assert s["architecture"] == "arm"
