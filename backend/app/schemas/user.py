from pydantic import BaseModel, ConfigDict


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    email: str | None = None
    is_admin: bool
    role: str
    org_id: int | None = None
    usergroup_id: int | None = None


class UserCreate(BaseModel):
    username: str
    email: str  # obrigatório: usado como login (e-mail + senha)
    password: str
    role: str = "operator"  # operator | admin | master (master só por Master)
    org_id: int | None = None  # ignorado para não-master (usa a ORG do criador)


class UserUpdate(BaseModel):
    email: str | None = None
    password: str | None = None
    role: str | None = None
    usergroup_id: int | None = None
