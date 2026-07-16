from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import Classification, Protocol, TargetKind


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ts: datetime
    actor: str
    target_kind: TargetKind
    target_id: int
    protocol: Protocol
    command: str
    classification: Classification
    ok: bool
    error: str | None
    duration_ms: int
    output_summary: str
