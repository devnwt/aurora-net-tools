"""Classificação read/write por device_type — allowlist default-deny (decisão §13).

Um comando só é considerado `read` se casar com a allowlist de leitura do
fabricante. Qualquer outra coisa (inclusive verbos de escrita conhecidos e
comandos desconhecidos) é tratada como `write` e recusada no MVP.
"""

import re

from app.models.enums import Classification, DeviceType

# Verbos/padrões de LEITURA por device_type.
_READ_PATTERNS: dict[DeviceType, list[str]] = {
    # RouterOS: ".. print", "export", ".. monitor", "/system resource print"
    DeviceType.routeros: [r"\bprint\b", r"\bexport\b", r"\bget\b", r"\bmonitor\b", r"\bfind\b"],
    # Cisco IOS/XE: "show ...", "display ..." (display p/ compatibilidade)
    DeviceType.cisco: [r"^\s*show\b", r"^\s*display\b"],
    # Huawei VRP: "display ...", "show ..."
    DeviceType.huawei: [r"^\s*display\b", r"^\s*show\b"],
}

# Verbos de ESCRITA conhecidos — mapeados desde já para a fase 2 (auditoria/relatório).
_WRITE_PATTERNS: list[str] = [
    r"\badd\b", r"\bset\b", r"\bremove\b", r"\bdelete\b", r"\bunset\b",
    r"\bmove\b", r"\benable\b", r"\bdisable\b", r"\breset\b",
    r"^\s*conf(igure)?\b", r"^\s*no\b", r"^\s*write\b", r"^\s*copy\b",
    r"^\s*reload\b", r"^\s*clear\b",
]


def classify_command(device_type: DeviceType, command: str) -> Classification:
    cmd = (command or "").strip()
    if not cmd:
        return Classification.write  # vazio → bloqueado por segurança

    patterns = _READ_PATTERNS.get(device_type, [])
    is_read = any(re.search(p, cmd, re.IGNORECASE) for p in patterns)
    is_write = any(re.search(p, cmd, re.IGNORECASE) for p in _WRITE_PATTERNS)

    # default-deny: só é leitura se casar com a allowlist E não casar com escrita.
    if is_read and not is_write:
        return Classification.read
    return Classification.write
