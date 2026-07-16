from pydantic import BaseModel, ConfigDict


class TemplateBase(BaseModel):
    name: str
    description: str = ""
    category: str = "Other"
    type: str = "commands"  # commands | script
    body: str = ""
    enabled: bool = True


class TemplateCreate(TemplateBase):
    pass


class TemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    type: str | None = None
    body: str | None = None
    enabled: bool | None = None


class TemplateOut(TemplateBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
