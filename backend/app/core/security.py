import hashlib
import re
import secrets
from datetime import UTC, datetime, timedelta

import bcrypt
from jose import JWTError, jwt

from app.core.config import get_settings

settings = get_settings()

# bcrypt limita a senha a 72 bytes; truncamos explicitamente.
_BCRYPT_MAX = 72

# Política de senha (usada em criação, troca e redefinição).
PASSWORD_MIN = 6
PASSWORD_RULE = f"A senha deve ter ao menos {PASSWORD_MIN} caracteres, incluindo letras e números."


def password_error(password: str) -> str | None:
    """Valida a política de senha. Retorna a mensagem de erro, ou None se OK."""
    if len(password) < PASSWORD_MIN:
        return PASSWORD_RULE
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return PASSWORD_RULE
    return None


def hash_password(password: str) -> str:
    digest = bcrypt.hashpw(password.encode("utf-8")[:_BCRYPT_MAX], bcrypt.gensalt())
    return digest.decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:_BCRYPT_MAX], hashed.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(subject: str) -> str:
    expire = datetime.now(UTC) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return payload.get("sub")
    except JWTError:
        return None


def create_scoped_token(subject: str, purpose: str, minutes: int) -> str:
    """Token JWT com propósito (ex.: reset de senha), sem tabela extra."""
    expire = datetime.now(UTC) + timedelta(minutes=minutes)
    payload = {"sub": subject, "purpose": purpose, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_scoped_token(token: str, purpose: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
    if payload.get("purpose") != purpose:
        return None
    return payload.get("sub")


def generate_api_key() -> str:
    return "ak_" + secrets.token_urlsafe(24)


def hash_api_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
