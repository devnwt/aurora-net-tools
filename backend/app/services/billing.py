"""Integração com o hub de cobrança (checkout de planos pagos).

Cria uma cobrança em `POST {HUB_AURORA_URL}/v1/charges` (Bearer + Idempotency-Key)
e devolve a URL de pagamento. Config em `settings.hub_aurora_url/token`.
"""

import logging
import uuid

import httpx

from app.core.config import get_settings

log = logging.getLogger("aurora.billing")
settings = get_settings()


class BillingError(Exception):
    """Falha ao falar com o hub (config ausente, indisponível, erro HTTP)."""


class ChargeNotFound(BillingError):
    """A cobrança não existe mais no hub (404)."""


def enabled() -> bool:
    return bool(settings.hub_aurora_url and settings.hub_aurora_token)


async def create_charge(
    *, plan_code: str, external_id: str, external_reference: str, customer: dict,
    return_url: str | None = None,
) -> dict:
    """Cria uma cobrança no hub e retorna o JSON da resposta. Levanta BillingError.

    O valor NÃO é enviado: o preço vem do plano cadastrado no painel do hub. A
    correlação para o webhook vai em external_id/external_reference. `return_url` é
    para onde o hub redireciona o cliente ao concluir o checkout (a base do app)."""
    if not enabled():
        raise BillingError("integração de cobrança não configurada")
    url = settings.hub_aurora_url.rstrip("/") + "/v1/charges"
    payload = {
        "plan_code": plan_code,
        "external_id": external_id,
        "external_reference": external_reference,
        "customer": customer,
    }
    if return_url:
        payload["return_url"] = return_url
    headers = {
        "Authorization": f"Bearer {settings.hub_aurora_token}",
        "Idempotency-Key": str(uuid.uuid4()),
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        log.warning("cobrança: falha de rede ao chamar o hub: %s", exc)
        raise BillingError("não foi possível contatar o serviço de pagamento") from exc
    if resp.status_code >= 400:
        log.warning("cobrança: hub respondeu %s: %s", resp.status_code, resp.text[:300])
        raise BillingError("o serviço de pagamento recusou a cobrança")
    try:
        return resp.json()
    except ValueError as exc:
        raise BillingError("resposta inválida do serviço de pagamento") from exc


async def get_charge(charge_id: str) -> dict:
    """Consulta uma cobrança no hub (GET /v1/charges/{id}) — a reconciliação. A
    resposta é a mesma da criação, com `status`/`paid_at` atualizados. Levanta
    ChargeNotFound (404) ou BillingError."""
    if not enabled():
        raise BillingError("integração de cobrança não configurada")
    url = settings.hub_aurora_url.rstrip("/") + f"/v1/charges/{charge_id}"
    headers = {"Authorization": f"Bearer {settings.hub_aurora_token}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise BillingError("não foi possível contatar o serviço de pagamento") from exc
    if resp.status_code == 404:
        raise ChargeNotFound(charge_id)
    if resp.status_code >= 400:
        log.warning("consulta de cobrança %s: hub respondeu %s", charge_id, resp.status_code)
        raise BillingError(f"hub respondeu {resp.status_code}")
    try:
        return resp.json()
    except ValueError as exc:
        raise BillingError("resposta inválida do serviço de pagamento") from exc


def extract_payment_url(data: dict) -> str | None:
    """Acha a URL de pagamento na resposta, tolerando variações de nome/aninhamento."""
    if not isinstance(data, dict):
        return None
    for key in ("payment_url", "checkout_url", "url", "payment_link", "link"):
        val = data.get(key)
        if isinstance(val, str) and val.startswith("http"):
            return val
    for parent in ("data", "charge", "payment", "result"):
        inner = data.get(parent)
        if isinstance(inner, dict):
            found = extract_payment_url(inner)
            if found:
                return found
    return None
