"""Helpers de isolamento por ORG (multi-tenant).

Master enxerga tudo (inclusive recursos sem ORG). Admin/Operator só a própria ORG.
Recursos criados por não-master herdam o `org_id` do usuário.
"""

from fastapi import HTTPException

from app.models import User


def is_master(user: User) -> bool:
    return user.role == "master"


def scope(stmt, model, user: User):
    """Adiciona filtro `org_id == user.org_id` quando o usuário não é master."""
    if is_master(user):
        return stmt
    return stmt.where(model.org_id == user.org_id)


def owned(obj, user: User):
    """404 se o recurso não pertence à ORG do usuário (e ele não é master)."""
    if obj is None:
        raise HTTPException(404, "não encontrado")
    if not is_master(user) and getattr(obj, "org_id", None) != user.org_id:
        raise HTTPException(404, "não encontrado")
    return obj


def new_org_id(user: User) -> int | None:
    """ORG a atribuir em recursos recém-criados (None para master = recurso de sistema)."""
    return None if is_master(user) else user.org_id
