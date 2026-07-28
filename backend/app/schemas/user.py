from pydantic import BaseModel, ConfigDict


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str | None = None
    phone: str | None = None
    photo: str | None = None
    is_admin: bool
    is_active: bool = True
    role: str
    org_id: int | None = None
    usergroup_id: int | None = None


class UserCreate(BaseModel):
    # Sem username: o e-mail é o único identificador/login.
    email: str  # obrigatório: usado como login
    # Senha OPCIONAL: quando ausente, o usuário recebe um convite por e-mail para
    # definir a própria senha (fluxo padrão da UI). Presente só em usos internos/testes.
    password: str | None = None
    phone: str | None = None
    role: str = "operator"  # operator | admin | master (master só por Master)
    is_active: bool = True
    org_id: int | None = None  # ignorado para não-master (usa a ORG do criador)


class UserUpdate(BaseModel):
    email: str | None = None
    password: str | None = None
    phone: str | None = None
    role: str | None = None
    is_active: bool | None = None
    usergroup_id: int | None = None
