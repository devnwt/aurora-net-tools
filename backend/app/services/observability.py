"""Leitura dos logs JSONL para a aba Observabilidade (somente Master).

Quem *escreve* é `app/core/logging.py`; aqui só se lê. O arquivo é a fonte da
verdade — não há tabela nem estado paralelo, o que mantém a observabilidade
inteiramente fora do caminho crítico da aplicação.

Cuidados de custo (a aba não pode virar um jeito de derrubar o backend):
  * lê no máximo `SCAN_BYTES_PER_FILE` do fim de cada arquivo (o começo é o
    passado distante, já coberto pelos backups rotacionados);
  * varre no máximo `MAX_SCAN_LINES` linhas por consulta;
  * tudo é chamado com `asyncio.to_thread` pela camada de API — I/O de disco
    nunca segura o event loop.
"""

import json
import os
import re
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.core.logging import EVENTS_FILE

SCAN_BYTES_PER_FILE = 4 * 1024 * 1024
MAX_SCAN_LINES = 20_000
MAX_MATCHES = 2_000  # teto do resultado; `total` é o que coube nele

CRITICAL_LEVELS = ("CRITICAL", "ERROR")


def _log_dir() -> Path:
    """Diretório dos logs (isolado numa função para os testes apontarem outro)."""
    return Path(get_settings().log_dir)


def _files() -> list[Path]:
    """events.jsonl e seus backups, do mais recente para o mais antigo."""
    base = _log_dir() / EVENTS_FILE
    found = [base] if base.is_file() else []
    for i in range(1, get_settings().log_backup_count + 1):
        rotated = base.with_name(f"{EVENTS_FILE}.{i}")
        if rotated.is_file():
            found.append(rotated)
    return found


def _tail_lines(path: Path) -> list[str]:
    """Últimas linhas do arquivo (no máximo SCAN_BYTES_PER_FILE), da última pra 1ª."""
    try:
        with path.open("rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            start = max(0, size - SCAN_BYTES_PER_FILE)
            fh.seek(start)
            data = fh.read()
        if start and b"\n" in data:
            data = data.split(b"\n", 1)[1]  # descarta a 1ª linha, provavelmente cortada
        return data.decode("utf-8", "replace").splitlines()[::-1]
    except OSError:
        return []


def _iter_records(max_lines: int = MAX_SCAN_LINES):
    """Registros do mais recente para o mais antigo. Linha corrompida é ignorada."""
    seen = 0
    for path in _files():
        for line in _tail_lines(path):
            if seen >= max_lines:
                return
            seen += 1
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except (ValueError, TypeError):
                continue
            if isinstance(rec, dict):
                yield rec


def _parse_ts(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


# === Humanização =========================================================
# O objetivo é responder "o que quebrou?" sem ler stack trace. O backend devolve
# um CÓDIGO estável; o frontend traduz (ops:observability.friendly.<code>) e cai
# na mensagem crua se não conhecer o código.

_FRIENDLY_HINTS: list[tuple[str, tuple[str, ...]]] = [
    ("timeout", ("timeout", "timed out", "timeouterror")),
    ("connection", ("connection refused", "connectionrefused", "connectionerror", "unreachable", "no route to host")),
    ("database", ("operationalerror", "interfaceerror", "dbapierror", "asyncpg", "postgres", "psql", "deadlock")),
    ("redis", ("redis",)),
    ("conflict", ("integrityerror", "duplicate key", "unique constraint")),
    ("auth", ("unauthorized", "forbidden", "authenticationerror", "permissionerror", "invalid token", "expired")),
    ("validation", ("validationerror", "unprocessable")),
    ("notfound", ("notfound", "not found", "no such file")),
    ("ssh", ("ssh", "paramiko", "netmiko", "authenticationexception")),
    ("snmp", ("snmp", "no such object", "nosuchinstance")),
    ("external", ("httpstatuserror", "httpx", "requesterror", "s3", "smtp", "boto")),
]


def friendly_code(rec: dict[str, Any]) -> str:
    """Classifica o evento numa causa provável (código estável para o i18n)."""
    haystack = " ".join(
        str(rec.get(k) or "") for k in ("error_type", "message", "service", "logger")
    ).lower()
    for code, hints in _FRIENDLY_HINTS:
        if any(h in haystack for h in hints):
            return code
    status = rec.get("status")
    if isinstance(status, int):
        if status in (401, 403):
            return "auth"
        if status == 404:
            return "notfound"
        if status == 422:
            return "validation"
        if status >= 500:
            return "server"
    return "unknown"


_NOISE = [
    (re.compile(r"\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\b", re.I), "<id>"),
    (re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b"), "<ip>"),
    (re.compile(r"\b\d+\b"), "<n>"),
]


def _fingerprint(rec: dict[str, Any]) -> str:
    """Assinatura para agrupar ocorrências do MESMO erro (ids/ips/números viram curinga)."""
    msg = str(rec.get("message") or "")[:160]
    for pattern, repl in _NOISE:
        msg = pattern.sub(repl, msg)
    return f"{rec.get('service') or '?'}|{rec.get('error_type') or friendly_code(rec)}|{msg}"


# === Consultas ===========================================================

_LIST_FIELDS = (
    "id", "ts", "level", "logger", "service", "message", "request_id",
    "method", "path", "status", "user", "org_id", "duration_ms", "error_type",
)


def _to_item(rec: dict[str, Any]) -> dict[str, Any]:
    """Registro para a LISTA — sem stack trace (só aparece no detalhe)."""
    item = {k: rec.get(k) for k in _LIST_FIELDS}
    item["level"] = str(item.get("level") or "INFO").upper()
    item["service"] = item.get("service") or "app"
    item["message"] = item.get("message") or ""
    item["friendly"] = friendly_code(rec)
    item["has_stack"] = bool(rec.get("stack"))
    return item


def query(
    *,
    levels: list[str] | None = None,
    service: str | None = None,
    search: str | None = None,
    hours: int | None = 24,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    """Eventos filtrados, do mais recente para o mais antigo."""
    since = datetime.now(UTC) - timedelta(hours=hours) if hours else None
    wanted = {level.upper() for level in levels} if levels else None
    needle = (search or "").strip().lower()

    matched: list[dict[str, Any]] = []
    scanned = 0
    for rec in _iter_records():
        scanned += 1
        if wanted and str(rec.get("level", "")).upper() not in wanted:
            continue
        if service and rec.get("service") != service:
            continue
        if since is not None:
            ts = _parse_ts(rec.get("ts"))
            if ts is not None and ts < since:
                # Arquivo é cronológico e lido de trás pra frente: o resto é ainda
                # mais antigo, não há o que procurar adiante.
                break
        if needle:
            blob = " ".join(
                str(rec.get(k) or "") for k in ("message", "path", "service", "user", "error_type", "request_id")
            ).lower()
            if needle not in blob:
                continue
        matched.append(rec)
        if len(matched) >= MAX_MATCHES:
            break

    page = matched[offset : offset + limit]
    return {
        "items": [_to_item(r) for r in page],
        "total": len(matched),
        "scanned": scanned,
        "truncated": scanned >= MAX_SCAN_LINES,
    }


def get_event(event_id: str) -> dict[str, Any] | None:
    """Evento completo (inclui stack trace) — usado só na visão de detalhes."""
    for rec in _iter_records():
        if rec.get("id") == event_id:
            item = _to_item(rec)
            item["stack"] = rec.get("stack")
            item["user_id"] = rec.get("user_id")
            return item
    return None


def services() -> list[str]:
    """Módulos que aparecem nos logs — alimenta o filtro da aba."""
    found = {str(rec.get("service") or "app") for rec in _iter_records()}
    return sorted(found)


def summary(hours: int = 24) -> dict[str, Any]:
    """Visão geral do período: volume por nível, por serviço e erros recorrentes."""
    since = datetime.now(UTC) - timedelta(hours=hours) if hours else None
    by_level: Counter[str] = Counter()
    by_service: Counter[str] = Counter()
    groups: dict[str, dict[str, Any]] = {}
    total = 0
    last_ts: str | None = None

    for rec in _iter_records():
        ts = _parse_ts(rec.get("ts"))
        if since is not None and ts is not None and ts < since:
            break
        total += 1
        level = str(rec.get("level") or "INFO").upper()
        by_level[level] += 1
        by_service[str(rec.get("service") or "app")] += 1
        if last_ts is None:
            last_ts = rec.get("ts")

        if level in CRITICAL_LEVELS:
            key = _fingerprint(rec)
            group = groups.get(key)
            if group is None:
                groups[key] = {
                    "fingerprint": key,
                    "count": 1,
                    "level": level,
                    "service": rec.get("service") or "app",
                    "message": rec.get("message") or "",
                    "friendly": friendly_code(rec),
                    "last_ts": rec.get("ts"),
                    "last_id": rec.get("id"),
                }
            else:
                group["count"] += 1

    top = sorted(groups.values(), key=lambda g: g["count"], reverse=True)[:8]
    return {
        "hours": hours,
        "total": total,
        "critical": by_level.get("CRITICAL", 0) + by_level.get("ERROR", 0),
        "warnings": by_level.get("WARNING", 0),
        "by_level": dict(by_level),
        "by_service": dict(by_service.most_common(10)),
        "top_errors": top,
        "last_event_ts": last_ts,
        "available": bool(_files()),
    }
