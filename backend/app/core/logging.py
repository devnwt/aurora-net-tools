"""Logging da aplicação: stdout (operação) + arquivo JSONL (observabilidade).

O arquivo JSONL é a fonte da aba **Observabilidade** em /logs e existe para
investigação técnica — ele não é servido cru ao usuário final, quem lê é
`app/services/observability.py` (somente Master).

Três regras inegociáveis:

1. **Nunca derrubar a aplicação.** `logging.raiseExceptions = False` + criação do
   handler dentro de try/except: sem permissão de escrita, o app sobe igual e só
   a aba fica vazia.
2. **Nunca bloquear a requisição.** A escrita em disco fica atrás de um
   `QueueHandler` com fila limitada — sob pressão o registro é *descartado*, não
   enfileirado indefinidamente nem esperado.
3. **Nunca gravar segredo.** Todo texto (mensagem e stack) passa pelo redator
   antes de virar linha no arquivo.

O contexto da requisição (request_id, rota, usuário, ORG) chega aqui por
contextvars preenchidos pelo middleware de app/main.py — ver `bind_request`.
"""

import atexit
import json
import logging
import logging.handlers
import os
import queue
import re
import sys
import uuid
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

from app.core.config import get_settings

EVENTS_FILE = "events.jsonl"

# Limites de tamanho: log não é backup de payload. Trunca para o arquivo não
# virar despejo de resposta HTTP inteira.
MESSAGE_MAX = 2000
STACK_MAX = 8000
QUEUE_MAX = 10_000

# === Contexto da requisição ==============================================
# Guardamos um DICT mutável: o middleware cria e o `get_current_user` completa
# com o usuário depois (o Starlette roda o downstream numa task filha, que copia
# o contextvar — mutar o mesmo objeto propaga, reatribuir a var não).
_ctx_var: ContextVar[dict[str, Any] | None] = ContextVar("aurora_log_ctx", default=None)


def bind_request(request_id: str, method: str, path: str) -> dict[str, Any]:
    ctx: dict[str, Any] = {"request_id": request_id, "method": method, "path": path}
    _ctx_var.set(ctx)
    return ctx


def bind_user(*, user: str | None = None, user_id: int | None = None, org_id: int | None = None) -> None:
    """Completa o contexto com quem está autenticado (chamado pelas deps de auth)."""
    ctx = _ctx_var.get()
    if ctx is None:
        return
    if user:
        ctx["user"] = user
    if user_id:
        ctx["user_id"] = user_id
    if org_id is not None:
        ctx["org_id"] = org_id


def current_request_id() -> str | None:
    ctx = _ctx_var.get()
    return ctx.get("request_id") if ctx else None


# === Redação de segredos =================================================
# Chaves cujo VALOR nunca pode ir ao disco. A chave em si continua visível
# (saber *que* campo falhou é o que torna o log útil).
_SECRET_KEYS = (
    r"pass(?:word|wd)?|senha|secret|token|api[_-]?key|apikey|authorization|"
    r"credential|private[_-]?key|community|jwt|cookie|session"
)

_REDACTIONS: list[tuple[re.Pattern[str], str]] = [
    # chave=valor / "chave": "valor" / chave: valor
    # O ramo `Bearer|Basic|Token` vem antes do genérico: sem ele "Authorization:
    # Bearer <jwt>" perderia só a palavra "Bearer" e deixaria o token no arquivo.
    (
        re.compile(
            r'(?i)("?\b(?:' + _SECRET_KEYS + r')\b"?\s*[=:]\s*)'
            r'("[^"]*"|\'[^\']*\'|(?:Bearer|Basic|Token)\s+\S+|[^\s,;&)\]}]+)'
        ),
        r"\1***",
    ),
    # Authorization: Bearer <token>
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-]+"), "Bearer ***"),
    # JWT solto no meio do texto
    (re.compile(r"\beyJ[A-Za-z0-9._\-]{10,}"), "***jwt***"),
    # DSN com credencial embutida: scheme://user:senha@host
    (re.compile(r"(?i)\b([a-z][a-z0-9+.\-]*://)([^/\s:@]+):([^/\s@]+)@"), r"\1\2:***@"),
    # e-mail: preserva o domínio (útil pro suporte), esconde o identificador pessoal
    (
        re.compile(r"\b([A-Za-z0-9._%+\-]{1,2})[A-Za-z0-9._%+\-]*@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b"),
        r"\1***@\2",
    ),
]


def redact(text: str) -> str:
    """Remove segredos de um texto livre. Best-effort — nunca levanta."""
    if not text:
        return text
    try:
        for pattern, repl in _REDACTIONS:
            text = pattern.sub(repl, text)
    except Exception:  # redação jamais pode quebrar o log
        return "<redação falhou>"
    return text


# === Formatação ==========================================================


class RedactingFormatter(logging.Formatter):
    """Formato humano do stdout, com os segredos removidos.

    `docker compose logs` também é log: não adianta limpar o arquivo JSONL e
    deixar a senha em claro no stdout do container.
    """

    def format(self, record: logging.LogRecord) -> str:
        return redact(super().format(record))


def _service_of(logger_name: str) -> str:
    """Nome curto do módulo responsável: 'aurora.copilot' → 'copilot'."""
    parts = (logger_name or "root").split(".")
    if parts[0] == "aurora":
        return parts[1] if len(parts) > 1 else "api"
    return parts[0]


class JsonlFormatter(logging.Formatter):
    """Uma linha JSON por evento — formato lido pela aba Observabilidade."""

    def format(self, record: logging.LogRecord) -> str:
        ctx = _ctx_var.get() or {}
        try:
            message = record.getMessage()
        except Exception:  # args incompatíveis não podem quebrar o log
            message = str(record.msg)

        payload: dict[str, Any] = {
            "id": uuid.uuid4().hex,
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "service": _service_of(record.name),
            "message": redact(message)[:MESSAGE_MAX],
            "request_id": ctx.get("request_id"),
            "method": ctx.get("method"),
            "path": ctx.get("path"),
            "status": getattr(record, "status_code", None) or ctx.get("status"),
            "user": ctx.get("user"),
            "user_id": ctx.get("user_id"),
            "org_id": ctx.get("org_id"),
            "duration_ms": getattr(record, "duration_ms", None),
        }
        if record.exc_info and record.exc_info[0] is not None:
            payload["error_type"] = record.exc_info[0].__name__
            # Corta pelo FIM: o rodapé do traceback é onde está a exceção real.
            payload["stack"] = redact(self.formatException(record.exc_info))[-STACK_MAX:]

        payload = {k: v for k, v in payload.items() if v is not None}
        try:
            return json.dumps(payload, ensure_ascii=False, default=str)
        except Exception:
            return json.dumps({"ts": payload.get("ts"), "level": payload.get("level"), "message": "<log ilegível>"})


# === Setup ===============================================================

_listener: logging.handlers.QueueListener | None = None


def _build_file_handler(settings) -> logging.Handler | None:
    """RotatingFileHandler com formato JSONL. Devolve None se o diretório não der."""
    try:
        os.makedirs(settings.log_dir, exist_ok=True)
        handler = logging.handlers.RotatingFileHandler(
            os.path.join(settings.log_dir, EVENTS_FILE),
            maxBytes=settings.log_max_bytes,
            backupCount=settings.log_backup_count,
            encoding="utf-8",
            delay=True,
        )
        handler.setLevel(_file_level(settings))
        # O JSON já vem pronto do QueueHandler (ver configure_logging): aqui só
        # se escreve a linha. Formatar no thread da fila perderia os contextvars
        # da requisição, que só existem no thread que originou o log.
        handler.setFormatter(logging.Formatter("%(message)s"))
        return handler
    except Exception:  # sem disco a aplicação segue sem o arquivo
        return None


def _file_level(settings) -> int:
    return getattr(logging, str(settings.log_file_level).upper(), logging.WARNING)


def configure_logging() -> None:
    """Logging estruturado: stdout legível + arquivo JSONL para observabilidade."""
    global _listener

    # Um erro dentro de um handler nunca vira exceção/stderr da aplicação.
    logging.raiseExceptions = False
    settings = get_settings()

    stdout = logging.StreamHandler(sys.stdout)
    stdout.setFormatter(
        RedactingFormatter("%(asctime)s %(levelname)s [%(name)s] %(message)s", "%Y-%m-%dT%H:%M:%S%z")
    )

    handlers: list[logging.Handler] = [stdout]

    if _listener is not None:  # reconfiguração (testes) — não vaza a thread anterior
        try:
            _listener.stop()
        except Exception:
            pass
        _listener = None

    file_handler = _build_file_handler(settings)
    if file_handler is not None:
        # Fila limitada: se o disco não acompanhar, descarta em vez de segurar a
        # requisição (QueueHandler.emit engole o Full por causa do raiseExceptions).
        log_queue: queue.Queue = queue.Queue(maxsize=QUEUE_MAX)
        queue_handler = logging.handlers.QueueHandler(log_queue)
        # `QueueHandler.prepare()` formata ANTES de enfileirar (e descarta o
        # exc_info) — por isso o JsonlFormatter mora aqui: é o único ponto em que
        # ainda temos stack trace E o contexto da requisição.
        queue_handler.setFormatter(JsonlFormatter())
        queue_handler.setLevel(_file_level(settings))
        handlers.append(queue_handler)
        _listener = logging.handlers.QueueListener(log_queue, file_handler, respect_handler_level=True)
        _listener.start()
        atexit.register(_stop_listener)

    root = logging.getLogger()
    root.handlers = handlers
    root.setLevel(logging.INFO)
    # Reduz ruído do uvicorn access; mantém o nosso.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    if file_handler is None:
        logging.getLogger("aurora").warning(
            "observabilidade: sem escrita em %s — a aba Observabilidade ficará vazia", settings.log_dir
        )


def _stop_listener() -> None:
    global _listener
    if _listener is not None:
        try:
            _listener.stop()
        except Exception:
            pass
        _listener = None
