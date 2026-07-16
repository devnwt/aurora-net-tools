from pydantic import BaseModel, ConfigDict

from app.models.enums import ControllerKind


class ControllerBase(BaseModel):
    name: str
    kind: ControllerKind
    host: str
    port: int
    credential_id: int | None = None


class ControllerCreate(ControllerBase):
    pass


class ControllerUpdate(BaseModel):
    name: str | None = None
    host: str | None = None
    port: int | None = None
    credential_id: int | None = None


class ControllerOut(ControllerBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
