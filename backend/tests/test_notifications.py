"""Central de notificações: boas-vindas, contador, leitura, isolamento,
trial/expiração, dedup e idempotência."""

from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy import delete, select

from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models import Notification, Organization, Plan, User
from app.services import notifications as svc


async def _login(client, username: str, password: str) -> str:
    # Login é por e-mail; os usuários de teste usam {username}@t.test.
    res = await client.post("/auth/login", data={"username": f"{username}@t.test", "password": password})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


@pytest_asyncio.fixture
async def notif_setup(client, _schema):
    """ORG A (plano trial) com admin+operator; ORG B (plano pago) com admin.
    Limpa as notificações a cada teste (schema é session-scoped) e zera o
    vencimento (cada teste define o seu)."""
    async def goc(s, model, where, **defaults):
        obj = (await s.execute(select(model).where(where))).scalar_one_or_none()
        if obj is None:
            obj = model(**defaults)
            s.add(obj)
            await s.flush()
        return obj

    async with SessionLocal() as s:
        trial = await goc(s, Plan, Plan.name == "NotifTrial", name="NotifTrial", max_devices=5, max_users=5)
        paid = await goc(s, Plan, Plan.name == "NotifPaid", name="NotifPaid", max_devices=50, max_users=20)
        a = await goc(s, Organization, Organization.name == "NA_Org", name="NA_Org", plan_id=trial.id)
        b = await goc(s, Organization, Organization.name == "NB_Org", name="NB_Org", plan_id=paid.id)
        a.plan_id = trial.id
        a.plan_expires_at = None
        b.plan_id = paid.id
        b.plan_expires_at = None
        na_admin = await goc(s, User, User.username == "na_admin", username="na_admin", email="na_admin@t.test",
                             password_hash=hash_password("senha123"), role="admin", is_admin=True, org_id=a.id)
        na_op = await goc(s, User, User.username == "na_op", username="na_op", email="na_op@t.test",
                          password_hash=hash_password("senha123"), role="operator", org_id=a.id)
        nb_admin = await goc(s, User, User.username == "nb_admin", username="nb_admin", email="nb_admin@t.test",
                             password_hash=hash_password("senha123"), role="admin", is_admin=True, org_id=b.id)
        await s.execute(delete(Notification))  # slate limpo por teste
        await s.commit()
        return {"a": a.id, "b": b.id, "na_admin": na_admin.id, "na_op": na_op.id, "nb_admin": nb_admin.id}


async def _get_org(s, org_id):
    return (await s.execute(select(Organization).where(Organization.id == org_id))).scalar_one()


# 1. Boas-vindas ao criar conta ------------------------------------------------

async def test_welcome_on_user_creation(client, notif_setup):
    tok = await _login(client, "na_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    r = await client.post("/users", json={"username": "na_new", "email": "na_new@t.test", "password": "Senha@123", "role": "operator"})
    assert r.status_code == 201, r.text

    del client.headers["Authorization"]
    ntok = await _login(client, "na_new", "Senha@123")
    client.headers["Authorization"] = f"Bearer {ntok}"
    items = (await client.get("/notifications")).json()
    assert any(n["kind"] == "welcome" and "Bem-vindo" in n["title"] for n in items)
    assert (await client.get("/notifications/unread-count")).json()["count"] == 1


# 2/3/8. Contador, marcar como lida, atualização do contador -------------------

async def test_unread_count_mark_read_and_counter(client, notif_setup):
    async with SessionLocal() as s:
        await svc._emit(s, user_id=notif_setup["na_admin"], org_id=notif_setup["a"], kind="info", title="A", body="a", dedup_key="k1")
        await svc._emit(s, user_id=notif_setup["na_admin"], org_id=notif_setup["a"], kind="info", title="B", body="b", dedup_key="k2")
        await s.commit()

    tok = await _login(client, "na_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    assert (await client.get("/notifications/unread-count")).json()["count"] == 2

    first = (await client.get("/notifications")).json()[0]
    marked = await client.post(f"/notifications/{first['id']}/read")
    assert marked.status_code == 200 and marked.json()["read"] is True
    assert (await client.get("/notifications/unread-count")).json()["count"] == 1

    assert (await client.post("/notifications/read-all")).json()["updated"] == 1
    assert (await client.get("/notifications/unread-count")).json()["count"] == 0


# 4. Isolamento entre usuários/empresas ---------------------------------------

async def test_isolation_between_users(client, notif_setup):
    async with SessionLocal() as s:
        await svc._emit(s, user_id=notif_setup["nb_admin"], org_id=notif_setup["b"], kind="info", title="B-only", body="x", dedup_key="konly")
        await s.commit()
        bid = (await s.execute(select(Notification.id).where(Notification.user_id == notif_setup["nb_admin"]))).scalar_one()

    tok = await _login(client, "na_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    items = (await client.get("/notifications")).json()
    assert all(n["id"] != bid for n in items)  # não enxerga a da outra empresa
    # Não consegue marcar como lida a de outro usuário (404, sem revelar).
    assert (await client.post(f"/notifications/{bid}/read")).status_code == 404


# 5. Notificações de Trial -----------------------------------------------------

async def test_trial_notifications(client, notif_setup):
    async with SessionLocal() as s:
        org = await _get_org(s, notif_setup["a"])
        org.plan_expires_at = datetime.now(UTC) + timedelta(days=3)
        await s.commit()
        created = await svc.sync_org(s, await _get_org(s, notif_setup["a"]))
    assert created >= 2  # admin + operator

    tok = await _login(client, "na_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    items = (await client.get("/notifications")).json()
    assert any(n["kind"] == "trial" and "Trial termina em 3 dias" in n["body"] for n in items)
    # O operator da mesma empresa também recebe (per-user).
    del client.headers["Authorization"]
    otok = await _login(client, "na_op", "senha123")
    client.headers["Authorization"] = f"Bearer {otok}"
    assert any(n["kind"] == "trial" for n in (await client.get("/notifications")).json())


# 6. Notificações de expiração de plano pago ----------------------------------

async def test_plan_expiration_notifications(client, notif_setup):
    async with SessionLocal() as s:
        org = await _get_org(s, notif_setup["b"])
        org.plan_expires_at = datetime.now(UTC) + timedelta(days=7)
        await s.commit()
        await svc.sync_org(s, await _get_org(s, notif_setup["b"]))

    tok = await _login(client, "nb_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    items = (await client.get("/notifications")).json()
    assert any(n["kind"] == "plan" and "plano expira em 7 dias" in n["body"] for n in items)


# 7/9. Dedup + idempotência ----------------------------------------------------

async def test_dedup_and_idempotency(client, notif_setup):
    async with SessionLocal() as s:
        org = await _get_org(s, notif_setup["a"])
        org.plan_expires_at = datetime.now(UTC) + timedelta(days=1)  # "amanhã"
        await s.commit()
        # Rodar o sync várias vezes não duplica.
        await svc.sync_org(s, await _get_org(s, notif_setup["a"]))
        await svc.sync_org(s, await _get_org(s, notif_setup["a"]))
        await svc.sync_all(s)
        # ensure_welcome duas vezes → uma só.
        admin = (await s.execute(select(User).where(User.id == notif_setup["na_admin"]))).scalar_one()
        assert await svc.ensure_welcome(s, admin) is True
        assert await svc.ensure_welcome(s, admin) is False
        await s.commit()

    tok = await _login(client, "na_admin", "senha123")
    client.headers["Authorization"] = f"Bearer {tok}"
    items = (await client.get("/notifications")).json()
    trial = [n for n in items if n["kind"] == "trial"]
    welcome = [n for n in items if n["kind"] == "welcome"]
    assert len(trial) == 1  # uma faixa "amanhã", sem duplicar
    assert len(welcome) == 1
