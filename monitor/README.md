# Monitoramento leve (OBS-001)

## O que a API já expõe

| Endpoint | Uso |
|----------|-----|
| `GET /api/health` | Uptime Kuma / load balancer — `{"status":"ok","database":true,"redis":true}` |
| `GET /api/metrics` | Prometheus scrape — RED + `aurora_dependency_up{name="postgres\|redis"}` |

Não exige autenticação (pense em rede privada / não expor `:8090` na internet sem TLS+firewall).

### Métricas úteis

- `http_requests_total` / `http_request_duration_seconds_*` (instrumentator)
- `aurora_up` — processo vivo
- `aurora_dependency_up{name="postgres"}` / `{name="redis"}` — 1 saudável, 0 fora

Desligar: `METRICS_ENABLED=false` no `.env`.

## Uptime Kuma (alertas sem Grafana)

```bash
# Junto com a stack Aurora
docker compose -f docker-compose.yml -f docker-compose.monitor.yml up -d

# Harbor
docker compose -f docker-compose.harbor.yml -f docker-compose.monitor.yml up -d
```

1. Abra `http://SERVIDOR:3001` e crie a conta admin.
2. Add New Monitor → **HTTP(s)**:
   - URL: `http://proxy:8090/api/health` (rede Docker) **ou** `http://127.0.0.1:8090/api/health` (host)
   - Heartbeat: 60s
   - Keyword / JSON query: `"status":"ok"` (ou equivalente no Kuma)
3. Notifications → e-mail / Telegram / Discord (mesmo espírito do alerta de backup).

Opcional: segundo monitor só para `database`/`redis` via keyword, ou scrape Prometheus externo apontando para `/api/metrics`.
