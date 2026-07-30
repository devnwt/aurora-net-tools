"""Autosserviço de planos (/plans) — admin da ORG simula e aplica na PRÓPRIA org."""

import pytest_asyncio


async def _login(client, username: str, password: str) -> str:
    # Login é por e-mail; os usuários de teste usam {username}@t.test.
    res = await client.post("/auth/login", data={"username": f"{username}@t.test", "password": password})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


@pytest_asyncio.fixture
async def org_setup(client, _schema):
    """2 planos, 2 ORGs (Acme no Free) e admin/operator na Acme. Idempotente: o
    schema é session-scoped, então get-or-create + reset da Acme p/ Free isolam
    cada teste independente da ordem."""
    from sqlalchemy import select

    from app.core.db import SessionLocal
    from app.core.security import hash_password
    from app.models import Organization, Plan, User

    async def get_or_create(s, model, where, **defaults):
        obj = (await s.execute(select(model).where(where))).scalar_one_or_none()
        if obj is None:
            obj = model(**defaults)
            s.add(obj)
            await s.flush()
        return obj

    async with SessionLocal() as s:
        free = await get_or_create(s, Plan, Plan.name == "PlanFree", name="PlanFree", max_devices=5, max_users=3)
        pro = await get_or_create(s, Plan, Plan.name == "PlanPro", name="PlanPro", max_devices=50, max_users=20)
        basic = await get_or_create(s, Plan, Plan.name == "PlanBasic", name="PlanBasic", max_devices=20, max_users=10)
        acme = await get_or_create(s, Organization, Organization.name == "AcmeCo", name="AcmeCo", plan_id=free.id)
        other = await get_or_create(s, Organization, Organization.name == "OtherCo", name="OtherCo", plan_id=pro.id)
        acme.plan_id = free.id  # reset: cada teste começa com a Acme no Free, sem vencimento
        acme.plan_expires_at = None
        acme.plan_canceled = False
        acme.trial_expires_at = None  # reset: elegível ao trial (schema é session-scoped)
        other.plan_id = pro.id
        await get_or_create(s, User, User.username == "acme_admin", username="acme_admin", email="acme_admin@t.test",
                            password_hash=hash_password("senha123"), role="admin", is_admin=True, org_id=acme.id)
        await get_or_create(s, User, User.username == "acme_op", username="acme_op", email="acme_op@t.test",
                            password_hash=hash_password("senha123"), role="operator", org_id=acme.id)
        await s.commit()
        ids = {"free": free.id, "pro": pro.id, "basic": basic.id, "acme": acme.id, "other": other.id}

    async def refetch_other_plan():
        async with SessionLocal() as s:
            o = (await s.execute(select(Organization).where(Organization.id == ids["other"]))).scalar_one()
            return o.plan_id

    ids["_refetch_other"] = refetch_other_plan
    return ids


async def test_list_plans_requires_admin(client, org_setup):
    # Operator não acessa.
    tok = await _login(client, "acme_op", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    assert (await client.get("/plans")).status_code == 403
    assert (await client.get("/plans/current")).status_code == 403
    assert (await client.post("/plans/select", json={"plan_id": org_setup["pro"]})).status_code == 403


async def test_admin_sees_current_and_usage(client, org_setup):
    tok = await _login(client, "acme_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"

    plans = (await client.get("/plans")).json()
    names = {p["name"] for p in plans}
    assert names >= {"PlanPro", "PlanBasic"}  # planos pagos são ofertados
    assert "PlanFree" not in names  # o plano de teste não entra na oferta (só na criação)

    cur = (await client.get("/plans/current")).json()
    assert cur["has_org"] is True
    assert cur["plan_name"] == "PlanFree"
    assert cur["max_devices"] == 5 and cur["max_users"] == 3
    # A própria conta admin já conta como 1 usuário da ORG.
    assert cur["usage"]["users"] >= 1
    assert cur["usage"]["devices"] == 0


async def test_admin_applies_plan_to_own_org(client, org_setup):
    tok = await _login(client, "acme_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"

    res = await client.post("/plans/select", json={"plan_id": org_setup["pro"]})
    assert res.status_code == 200
    body = res.json()
    assert body["plan_name"] == "PlanPro"
    assert body["max_devices"] == 50 and body["max_users"] == 20

    # Persistiu e NÃO afetou a outra ORG.
    assert (await client.get("/plans/current")).json()["plan_name"] == "PlanPro"
    assert await org_setup["_refetch_other"]() == org_setup["pro"]  # Other segue no seu plano


async def test_select_unknown_plan_404(client, org_setup):
    tok = await _login(client, "acme_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    assert (await client.post("/plans/select", json={"plan_id": 999999})).status_code == 404


async def test_master_has_no_org(auth_client, org_setup):
    """Master (org_id nulo) vê os planos, mas não tem ORG para aplicar."""
    cur = (await auth_client.get("/plans/current")).json()
    assert cur["has_org"] is False
    assert (await auth_client.post("/plans/select", json={"plan_id": org_setup["pro"]})).status_code == 400


# === Cancelamento e expiração ===


async def _set_org(org_id: int, **fields):
    """Ajusta campos da ORG direto no banco (simula o Master definindo vencimento)."""
    from sqlalchemy import select

    from app.core.db import SessionLocal
    from app.models import Organization

    async with SessionLocal() as s:
        o = (await s.execute(select(Organization).where(Organization.id == org_id))).scalar_one()
        for k, v in fields.items():
            setattr(o, k, v)
        await s.commit()


async def test_cancel_keeps_access_until_expiry(client, org_setup):
    """Cancelar marca 'canceled' mas mantém o plano ativo (status canceled)."""
    tok = await _login(client, "acme_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"

    res = await client.post("/plans/cancel")
    assert res.status_code == 200
    body = res.json()
    assert body["canceled"] is True
    assert body["status"] == "canceled"
    assert body["expired"] is False
    assert body["max_devices"] == 5  # ainda vale (sem vencimento no passado)

    # Reativar desfaz.
    back = (await client.post("/plans/reactivate")).json()
    assert back["canceled"] is False
    assert back["status"] == "active"


async def test_expired_plan_blocks_creation(client, org_setup):
    from datetime import UTC, datetime, timedelta

    tok = await _login(client, "acme_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"

    # Master define vencimento no passado.
    await _set_org(org_setup["acme"], plan_expires_at=datetime.now(UTC) - timedelta(days=1))

    cur = (await client.get("/plans/current")).json()
    assert cur["status"] == "expired" and cur["expired"] is True

    # Criar device é bloqueado: SEM PLANO ATIVO (vencido) → o guard require_active_plan
    # barra as rotas de dados antes do endpoint, com o código plan_required.
    r = await client.post("/devices", json={"name": "d", "ip": "10.20.30.40", "device_type": "routeros"})
    assert r.status_code == 403
    detail = r.json()["detail"]
    assert isinstance(detail, dict) and detail.get("code") == "plan_required"

    # Re-selecionar um plano (pago) limpa o vencimento passado e reativa.
    sel = (await client.post("/plans/select", json={"plan_id": org_setup["pro"]})).json()
    assert sel["status"] == "active" and sel["expired"] is False


async def test_paid_plan_defaults_to_one_month(client, org_setup):
    """Assinar um plano pago grava vencimento padrão de ~1 mês. (O trial ~1 semana é
    gravado na criação da conta; o trial não é selecionável via /plans/select.)"""
    from datetime import UTC, datetime

    tok = await _login(client, "acme_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"

    # Plano pago (PlanPro não casa com a regra de trial) → ~30 dias.
    paid = (await client.post("/plans/select", json={"plan_id": org_setup["pro"]})).json()
    assert paid["status"] == "active" and paid["expired"] is False
    assert paid["expires_at"] is not None
    days_paid = (datetime.fromisoformat(paid["expires_at"]) - datetime.now(UTC)).days
    assert 27 <= days_paid <= 32, days_paid


async def test_trial_only_at_creation_and_never_reselected(client, org_setup):
    """O trial é concedido só na CRIAÇÃO da conta: não é ofertado em /plans, não pode
    ser (re)selecionado, e depois de ativar um plano pago não há como voltar a ele
    (trial_available vira False)."""
    tok = await _login(client, "acme_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"

    # Acme começa no trial (PlanFree): elegível, mas o trial não aparece na oferta.
    cur = (await client.get("/plans/current")).json()
    assert cur["trial_available"] is True
    assert "PlanFree" not in {p["name"] for p in (await client.get("/plans")).json()}

    # (Re)selecionar o plano de teste é sempre bloqueado.
    blocked = await client.post("/plans/select", json={"plan_id": org_setup["free"]})
    assert blocked.status_code == 400
    assert "teste" in blocked.json()["detail"].lower()

    # Ativado um plano pago → trial_available False e não dá para voltar ao trial.
    assert (await client.post("/plans/select", json={"plan_id": org_setup["pro"]})).status_code == 200
    assert (await client.get("/plans/current")).json()["trial_available"] is False
    assert (await client.post("/plans/select", json={"plan_id": org_setup["free"]})).status_code == 400


async def test_plan_change_emits_welcome_notification(client, org_setup):
    """Trocar de plano gera uma notificação de boas-vindas ao novo plano (1x por plano)."""
    from sqlalchemy import delete

    from app.core.db import SessionLocal
    from app.models import Notification

    # Slate limpo (schema é session-scoped e outros testes também trocam de plano).
    async with SessionLocal() as s:
        await s.execute(delete(Notification).where(Notification.org_id == org_setup["acme"]))
        await s.commit()

    tok = await _login(client, "acme_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"

    def welcomes(items):
        return [n for n in items if n["kind"] == "plan_welcome"]

    # Free → Pro: 1 boas-vindas ao Pro.
    await client.post("/plans/select", json={"plan_id": org_setup["pro"]})
    w = welcomes((await client.get("/notifications")).json())
    assert len(w) == 1 and "PlanPro" in w[0]["body"]

    # Reaplicar o mesmo plano NÃO duplica.
    await client.post("/plans/select", json={"plan_id": org_setup["pro"]})
    assert len(welcomes((await client.get("/notifications")).json())) == 1

    # Trocar para outro plano (pago) gera novo aviso.
    await client.post("/plans/select", json={"plan_id": org_setup["basic"]})
    assert len(welcomes((await client.get("/notifications")).json())) == 2


async def test_future_expiry_still_active(client, org_setup):
    from datetime import UTC, datetime, timedelta

    tok = await _login(client, "acme_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    await _set_org(org_setup["acme"], plan_expires_at=datetime.now(UTC) + timedelta(days=5), plan_canceled=False)

    cur = (await client.get("/plans/current")).json()
    assert cur["status"] == "active"
    assert cur["expired"] is False
    assert cur["expires_at"] is not None
