from pydantic import BaseModel

from app.models.enums import Protocol


class ExecRequest(BaseModel):
    command: str
    protocol: Protocol = Protocol.ssh  # ssh ou telnet


class ExecResponse(BaseModel):
    ok: bool
    output: str


class SnmpRequest(BaseModel):
    oid: str


class SnmpResponse(BaseModel):
    ok: bool
    count: int
    records: list[dict]


class TestResponse(BaseModel):
    ok: bool
    results: dict
