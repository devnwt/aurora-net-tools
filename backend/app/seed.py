"""Seed idempotente: admin + controller UNM2000 a partir do .env (decisão §9).

Uso: python -m app.seed
"""

import asyncio

from sqlalchemy import select

from app.core.config import get_settings
from app.core.crypto import encrypt
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models import Controller, Credential, User
from app.models.enums import ControllerKind, CredentialKind


async def seed() -> None:
    settings = get_settings()
    async with SessionLocal() as session:
        # Admin
        if settings.admin_password:
            existing = (
                await session.execute(
                    select(User).where(User.username == settings.admin_username)
                )
            ).scalar_one_or_none()
            if existing is None:
                session.add(
                    User(
                        username=settings.admin_username,
                        email=(settings.admin_email.strip().lower() or None),
                        password_hash=hash_password(settings.admin_password),
                        is_admin=True,
                        role="master",
                    )
                )
                print(f"[seed] admin master '{settings.admin_username}' criado")

        # Controller UNM2000 a partir do .env (credencial TL1 cifrada)
        if settings.tl1_host and settings.tl1_username:
            existing_ctrl = (
                await session.execute(
                    select(Controller).where(Controller.host == settings.tl1_host)
                )
            ).scalar_one_or_none()
            if existing_ctrl is None:
                cred = Credential(
                    name="UNM2000 TL1",
                    kind=CredentialKind.tl1,
                    username=settings.tl1_username,
                    secret=encrypt(settings.tl1_password),
                )
                session.add(cred)
                await session.flush()
                session.add(
                    Controller(
                        name="UNM2000",
                        kind=ControllerKind.fiberhome_unm2000,
                        host=settings.tl1_host,
                        port=settings.tl1_port,
                        credential_id=cred.id,
                    )
                )
                print(f"[seed] controller UNM2000 ({settings.tl1_host}) criado")

        await session.commit()
    print("[seed] concluído")


if __name__ == "__main__":
    asyncio.run(seed())
