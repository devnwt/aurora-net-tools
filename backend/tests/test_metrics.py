"""OBS-001 — /metrics Prometheus (RED + gauges de dependência)."""


async def test_metrics_endpoint_exposes_prometheus_text(client, _schema):
    # Gera pelo menos uma request instrumentada antes do scrape.
    await client.get("/health")
    res = await client.get("/metrics")
    assert res.status_code == 200, res.text
    body = res.text
    assert "text/plain" in res.headers.get("content-type", "")
    assert "aurora_up" in body
    assert "aurora_dependency_up" in body
    assert 'name="postgres"' in body
    assert 'name="redis"' in body
    # RED do instrumentator (nome padrão da lib).
    assert "http_request" in body


async def test_health_updates_dependency_gauges(client, _schema):
    health = await client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    metrics = (await client.get("/metrics")).text
    assert 'aurora_dependency_up{name="postgres"} 1.0' in metrics or 'aurora_dependency_up{name="postgres"} 1' in metrics
    assert 'aurora_dependency_up{name="redis"} 1.0' in metrics or 'aurora_dependency_up{name="redis"} 1' in metrics
