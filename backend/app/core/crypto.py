import base64
import hashlib

from cryptography.fernet import Fernet

from app.core.config import get_settings

SECRET_MASK = "********"


def _fernet() -> Fernet:
    """Deriva uma chave Fernet a partir de APP_SECRET_KEY.

    Aceita qualquer string como APP_SECRET_KEY; deriva 32 bytes via SHA-256
    e codifica em urlsafe base64 (formato exigido pelo Fernet).
    """
    settings = get_settings()
    digest = hashlib.sha256(settings.app_secret_key.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt(value: str) -> str:
    if value is None:
        return value
    return _fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt(token: str) -> str:
    if not token:
        return token
    return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
