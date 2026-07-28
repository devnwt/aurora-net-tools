from datetime import datetime

from pydantic import BaseModel


class EventOut(BaseModel):
    """Evento na LISTA — sem stack trace (ver EventDetailOut)."""

    id: str | None = None
    ts: datetime | None = None
    level: str
    logger: str | None = None
    service: str
    message: str
    friendly: str  # código de causa provável, traduzido no frontend
    request_id: str | None = None
    method: str | None = None
    path: str | None = None
    status: int | None = None
    user: str | None = None
    org_id: int | None = None
    duration_ms: int | None = None
    error_type: str | None = None
    has_stack: bool = False


class EventPage(BaseModel):
    items: list[EventOut]
    total: int
    scanned: int
    truncated: bool  # a varredura bateu no teto: há eventos mais antigos não lidos


class EventDetailOut(EventOut):
    """Detalhe técnico — único lugar em que o stack trace é devolvido."""

    stack: str | None = None
    user_id: int | None = None


class ErrorGroupOut(BaseModel):
    fingerprint: str
    count: int
    level: str
    service: str
    message: str
    friendly: str
    last_ts: datetime | None = None
    last_id: str | None = None


class SummaryOut(BaseModel):
    hours: int | None = None
    total: int
    critical: int
    warnings: int
    by_level: dict[str, int]
    by_service: dict[str, int]
    top_errors: list[ErrorGroupOut]
    last_event_ts: datetime | None = None
    available: bool  # False = nenhum arquivo de log ainda (volume novo/sem escrita)
