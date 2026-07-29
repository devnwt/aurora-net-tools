"""Verificação de e-mail no cadastro: guarda o cadastro PENDENTE no Redis (com
TTL) e valida o e-mail ANTES da escolha do plano. A conta só é criada no final
(escolha do plano), então nada é gravado no banco até tudo estar confirmado.

Fluxo: register (guarda pendência + envia código) → verify-email (marca
`verified`) → complete-registration (cria a conta com o plano). O código é
numérico de 6 dígitos; a senha fica em hash; há limite de tentativas.
"""

import json
import logging
import secrets

from app.core.redis import redis_client

log = logging.getLogger("aurora.security")

# Validade do CÓDIGO enviado (2 min). Após verificar o e-mail, a pendência ganha
# uma janela maior (VERIFIED_TTL) para o usuário escolher o plano sem pressa.
CODE_TTL = 120       # 2 min de validade do código
VERIFIED_TTL = 900   # 15 min após verificado (para concluir a escolha do plano)
MAX_ATTEMPTS = 5
CODE_LEN = 6


def _key(email: str) -> str:
    return f"emailverify:{email.strip().lower()}"


def generate_code() -> str:
    return f"{secrets.randbelow(10 ** CODE_LEN):0{CODE_LEN}d}"


async def start(email: str, payload: dict, *, needs_code: bool) -> str | None:
    """Cria/renova um cadastro pendente. Se `needs_code`, gera e retorna o código
    (e-mail ainda NÃO verificado, validade CODE_TTL); senão marca como verificado
    (sem SMTP/testes) já com a janela maior."""
    code = generate_code() if needs_code else None
    data = {**payload, "verified": not needs_code, "code": code, "attempts": 0}
    ttl = CODE_TTL if needs_code else VERIFIED_TTL
    await redis_client.set(_key(email), json.dumps(data), ex=ttl)
    return code


async def get(email: str) -> dict | None:
    raw = await redis_client.get(_key(email))
    return json.loads(raw) if raw else None


async def clear(email: str) -> None:
    await redis_client.delete(_key(email))


async def resend(email: str) -> str | None:
    """Gera um código novo para um cadastro pendente ainda não verificado."""
    data = await get(email)
    if data is None:
        return None
    code = generate_code()
    data["code"] = code
    data["attempts"] = 0
    data["verified"] = False
    await redis_client.set(_key(email), json.dumps(data), ex=CODE_TTL)
    return code


async def verify(email: str, code: str) -> str:
    """Confere o código e, em sucesso, marca a pendência como verificada (mantendo-a
    para a etapa do plano). Retorna: 'ok' | 'expired' | 'invalid' | 'locked'."""
    key = _key(email)
    data = await get(email)
    if data is None:
        return "expired"
    if int(data.get("attempts", 0)) >= MAX_ATTEMPTS:
        await redis_client.delete(key)
        return "locked"
    if str(code).strip() != str(data.get("code")):
        data["attempts"] = int(data.get("attempts", 0)) + 1
        ttl = await redis_client.ttl(key)  # preserva a validade restante do código
        await redis_client.set(key, json.dumps(data), ex=ttl if isinstance(ttl, int) and ttl > 0 else CODE_TTL)
        return "invalid"
    data["verified"] = True
    await redis_client.set(key, json.dumps(data), ex=VERIFIED_TTL)  # janela maior p/ escolher o plano
    return "ok"
