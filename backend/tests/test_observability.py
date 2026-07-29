"""Observabilidade — autorização (só Master) e higiene dos logs.

O ponto central: esconder a aba no frontend não é controle de acesso. Estes
testes batem direto na API com admin e operator para garantir o 403.
"""

import json

import pytest
import pytest_asyncio

from app.core.logging import JsonlFormatter, RedactingFormatter, redact
from app.services import observability

OBS_ROUTES = [
    "/observability/events",
    "/observability/summary",
    "/observability/services",
    "/observability/events/inexistente",
]


async def _user_client(client, username: str, role: str, password: str = "senha123"):
    """Cria um usuário com o papel pedido e devolve um client autenticado como ele."""
    from sqlalchemy import select

    from app.core.db import SessionLocal
    from app.core.security import hash_password
    from app.models import User

    async with SessionLocal() as session:
        existing = (await session.execute(select(User).where(User.username == username))).scalar_one_or_none()
        if existing is None:
            session.add(
                User(
                    username=username,
                    email=f"{username}@example.test",
                    password_hash=hash_password(password),
                    is_admin=role == "admin",
                    role=role,
                )
            )
            await session.commit()

    # Login é por e-mail; o usuário criado acima usa {username}@example.test.
    res = await client.post("/auth/login", data={"username": f"{username}@example.test", "password": password})
    assert res.status_code == 200, res.text
    client.headers["Authorization"] = f"Bearer {res.json()['access_token']}"
    return client


@pytest_asyncio.fixture
async def log_dir(tmp_path, monkeypatch):
    """Aponta o leitor para um diretório de logs isolado do teste."""
    monkeypatch.setattr(observability, "_log_dir", lambda: tmp_path)
    return tmp_path


def _write_events(path, records):
    with (path / "events.jsonl").open("w", encoding="utf-8") as fh:
        for rec in records:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")


# === Autorização (o requisito central) ===================================


@pytest.mark.parametrize("route", OBS_ROUTES)
async def test_observability_requires_auth(client, route):
    assert (await client.get(route)).status_code == 401


@pytest.mark.parametrize("route", OBS_ROUTES)
async def test_observability_denies_admin(client, _schema, route):
    """Admin de ORG é privilegiado, mas NÃO enxerga os logs do sistema."""
    as_admin = await _user_client(client, "obs_admin", "admin")
    assert (await as_admin.get(route)).status_code == 403


@pytest.mark.parametrize("route", OBS_ROUTES)
async def test_observability_denies_operator(client, _schema, route):
    as_operator = await _user_client(client, "obs_operator", "operator")
    assert (await as_operator.get(route)).status_code == 403


async def test_observability_allows_master(auth_client, log_dir):
    """O Master (fixture `admin`, role=master) passa em todas as rotas."""
    _write_events(log_dir, [])
    for route in ("/observability/events", "/observability/summary", "/observability/services"):
        assert (await auth_client.get(route)).status_code == 200, route


# === Leitura, filtros e detalhes =========================================


def _sample(ts: str, **over):
    base = {
        "id": over.pop("id", "evt-1"),
        "ts": ts,
        "level": "ERROR",
        "logger": "aurora.poller",
        "service": "poller",
        "message": "falha ao coletar device",
        "path": "/devices/1",
        "method": "GET",
        "status": 500,
        "error_type": "TimeoutError",
        "stack": "Traceback (most recent call last): ...",
    }
    base.update(over)
    return base


async def test_events_filters_and_hides_stack(auth_client, log_dir):
    from datetime import UTC, datetime

    now = datetime.now(UTC).isoformat()
    _write_events(
        log_dir,
        [
            _sample(now, id="evt-warn", level="WARNING", service="webhooks", message="retentativa de webhook"),
            _sample(now, id="evt-err"),
        ],
    )

    todos = (await auth_client.get("/observability/events")).json()
    assert todos["total"] == 2
    # Stack trace NUNCA vai na listagem — só o indicador de que existe.
    assert all("stack" not in item for item in todos["items"])
    assert any(item["has_stack"] for item in todos["items"])

    so_erro = (await auth_client.get("/observability/events?level=ERROR")).json()
    assert [i["id"] for i in so_erro["items"]] == ["evt-err"]

    por_servico = (await auth_client.get("/observability/events?service=webhooks")).json()
    assert [i["id"] for i in por_servico["items"]] == ["evt-warn"]

    busca = (await auth_client.get("/observability/events?q=webhook")).json()
    assert [i["id"] for i in busca["items"]] == ["evt-warn"]


async def test_event_detail_has_stack_and_404(auth_client, log_dir):
    from datetime import UTC, datetime

    _write_events(log_dir, [_sample(datetime.now(UTC).isoformat(), id="evt-detalhe")])

    detalhe = await auth_client.get("/observability/events/evt-detalhe")
    assert detalhe.status_code == 200
    assert detalhe.json()["stack"].startswith("Traceback")
    assert detalhe.json()["friendly"] == "timeout"  # humanizado a partir do error_type

    assert (await auth_client.get("/observability/events/nao-existe")).status_code == 404


async def test_summary_groups_recurring_errors(auth_client, log_dir):
    from datetime import UTC, datetime

    now = datetime.now(UTC).isoformat()
    _write_events(
        log_dir,
        [
            _sample(now, id=f"evt-{i}", message=f"timeout no device {i}")  # ids/números viram curinga
            for i in range(3)
        ]
        + [_sample(now, id="evt-w", level="WARNING")],
    )

    resumo = (await auth_client.get("/observability/summary")).json()
    assert resumo["critical"] == 3
    assert resumo["warnings"] == 1
    assert resumo["top_errors"][0]["count"] == 3  # as 3 ocorrências agrupadas em 1 linha


async def test_missing_log_dir_does_not_break(auth_client, tmp_path, monkeypatch):
    """Sem arquivo de log a aba fica vazia — não pode virar 500."""
    monkeypatch.setattr(observability, "_log_dir", lambda: tmp_path / "inexistente")
    assert (await auth_client.get("/observability/events")).json()["total"] == 0
    assert (await auth_client.get("/observability/summary")).json()["available"] is False


# === Caminho completo: exceção na app → arquivo → API ====================


@pytest_asyncio.fixture
async def live_logging(tmp_path, monkeypatch):
    """Religa o logging real (fila + arquivo) apontado para um diretório de teste."""
    from app.core.config import get_settings
    from app.core.logging import _stop_listener, configure_logging

    settings = get_settings()
    monkeypatch.setattr(settings, "log_dir", str(tmp_path))
    monkeypatch.setattr(settings, "log_file_level", "WARNING")
    monkeypatch.setattr(observability, "_log_dir", lambda: tmp_path)
    configure_logging()
    yield tmp_path
    _stop_listener()
    monkeypatch.undo()
    configure_logging()  # devolve a configuração real pros demais testes


async def test_unhandled_error_flows_to_observability(auth_client, live_logging):
    """Uma exceção não tratada vira evento consultável — com rota, usuário e stack."""
    from fastapi import Depends
    from httpx import ASGITransport, AsyncClient

    from app.api.deps import get_current_user
    from app.core.logging import _stop_listener
    from app.main import app

    # Autenticada de propósito: é `get_current_user` quem carimba o usuário no
    # contexto de log, e queremos provar que o evento sai identificado.
    @app.get("/_teste_boom")
    async def _boom(_=Depends(get_current_user)):  # pragma: no cover - só levanta
        raise RuntimeError("explodiu de propósito com password=naopodevazar")

    # O ServerErrorMiddleware do Starlette responde 500 e RE-LEVANTA (em produção
    # quem engole é o uvicorn). Sem raise_app_exceptions=False o teste receberia a
    # exceção em vez da resposta que o cliente real vê.
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as boom_client:
        boom_client.headers["Authorization"] = auth_client.headers["Authorization"]
        res = await boom_client.get("/_teste_boom")
    assert res.status_code == 500
    assert res.json()["detail"] == "erro interno do servidor"
    request_id = res.json()["request_id"]  # correlaciona resposta e log

    _stop_listener()  # drena a fila antes de ler o arquivo

    encontrados = (await auth_client.get("/observability/events?hours=1")).json()["items"]
    evento = next(e for e in encontrados if e["request_id"] == request_id)
    assert evento["level"] == "ERROR"
    assert evento["path"] == "/_teste_boom"
    assert evento["method"] == "GET"
    assert evento["user"] == "admin"  # contexto preenchido por get_current_user
    assert evento["error_type"] == "RuntimeError"
    assert "naopodevazar" not in evento["message"]  # redigido mesmo vindo de exceção

    detalhe = (await auth_client.get(f"/observability/events/{evento['id']}")).json()
    assert "RuntimeError" in detalhe["stack"]
    assert "naopodevazar" not in detalhe["stack"]


# === Redação de segredos =================================================


@pytest.mark.parametrize(
    "raw,proibido",
    [
        ('login falhou {"password": "Ua2125d8to@"}', "Ua2125d8to@"),
        ("token=eyJhbGciOiJIUzI1NiJ9.abc.def falhou", "eyJhbGciOiJIUzI1NiJ9"),
        ("Authorization: Bearer abc123secret", "abc123secret"),
        ("api_key=sk-live-12345", "sk-live-12345"),
        ("postgresql://aurora:senhadobanco@postgres:5432/aurora", "senhadobanco"),
        ("erro ao notificar murilo@nwt.net.br", "murilo@"),
    ],
)
def test_redact_removes_secrets(raw, proibido):
    assert proibido not in redact(raw)


def test_stdout_formatter_also_redacts():
    """`docker compose logs` não pode virar a brecha por onde a senha escapa."""
    import logging

    record = logging.LogRecord(
        name="aurora",
        level=logging.WARNING,
        pathname=__file__,
        lineno=1,
        msg="conectando com senha=%s",
        args=("segredo123",),
        exc_info=None,
    )
    assert "segredo123" not in RedactingFormatter("%(message)s").format(record)


def test_formatter_redacts_and_keeps_context():
    import logging

    record = logging.LogRecord(
        name="aurora.auth",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg="falha no login password=%s",
        args=("segredo123",),
        exc_info=None,
    )
    payload = json.loads(JsonlFormatter().format(record))
    assert "segredo123" not in payload["message"]
    assert payload["service"] == "auth"  # 'aurora.auth' → módulo responsável
    assert payload["level"] == "ERROR"
    assert payload["id"]
