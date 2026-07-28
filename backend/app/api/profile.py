"""Meu Perfil: o usuário autenticado edita as PRÓPRIAS credenciais.

Regras: o e-mail NÃO é editável (é o login). Telefone e foto podem ser alterados.
A senha só muda informando a senha atual (proteção contra sequestro de sessão).
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.db import get_session
from app.core.security import hash_password, password_error, verify_password
from app.models import User

router = APIRouter(prefix="/profile", tags=["profile"])

# ~1,5 MB de data URL (o cliente já redimensiona a foto para um avatar pequeno).
_MAX_PHOTO_CHARS = 1_500_000


def _out(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "phone": u.phone,
        "photo": u.photo,
        "role": u.role,
        "is_admin": u.is_admin,
        "org_id": u.org_id,
    }


@router.get("")
async def get_profile(me: User = Depends(get_current_user)) -> dict:
    return _out(me)


class ProfileUpdate(BaseModel):
    phone: str | None = None
    # Foto como data URL (ex.: "data:image/png;base64,..."); "" ou null remove.
    photo: str | None = None


@router.patch("")
async def update_profile(
    payload: ProfileUpdate, session: AsyncSession = Depends(get_session), me: User = Depends(get_current_user)
) -> dict:
    data = payload.model_dump(exclude_unset=True)
    if "phone" in data:
        me.phone = (data["phone"] or "").strip() or None
    if "photo" in data:
        photo = data["photo"]
        if not photo:
            me.photo = None
        else:
            if not photo.startswith("data:image/"):
                raise HTTPException(400, "imagem inválida")
            if len(photo) > _MAX_PHOTO_CHARS:
                raise HTTPException(400, "imagem muito grande — envie uma foto menor")
            me.photo = photo
    await session.commit()
    await session.refresh(me)
    return _out(me)


class PasswordChange(BaseModel):
    old_password: str
    new_password: str


@router.post("/password")
async def change_password(
    payload: PasswordChange, session: AsyncSession = Depends(get_session), me: User = Depends(get_current_user)
) -> dict:
    # Só troca a senha quem prova conhecer a atual.
    if not verify_password(payload.old_password, me.password_hash):
        raise HTTPException(400, "senha atual incorreta")
    err = password_error(payload.new_password)
    if err:
        raise HTTPException(400, err)
    me.password_hash = hash_password(payload.new_password)
    await session.commit()
    return {"ok": True}


class InitialPassword(BaseModel):
    new_password: str


@router.post("/set-password")
async def set_initial_password(
    payload: InitialPassword, session: AsyncSession = Depends(get_session), me: User = Depends(get_current_user)
) -> dict:
    """Define a PRIMEIRA senha de um usuário convidado (sem senha ainda). Quem já
    tem senha precisa usar /profile/password (com a senha atual)."""
    if me.password_hash:
        raise HTTPException(400, "você já possui senha — use a troca de senha com a senha atual")
    err = password_error(payload.new_password)
    if err:
        raise HTTPException(400, err)
    me.password_hash = hash_password(payload.new_password)
    await session.commit()
    return {"ok": True}
