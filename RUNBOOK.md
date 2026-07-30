# Aurora Nettools — Runbook de Operação

Guia operacional do MVP. Para o design e o registro de decisões, ver [`SPEC.md`](./SPEC.md).

## Subir / atualizar

```bash
cp .env.example .env     # preencha os segredos (ver abaixo)
docker compose up --build -d
docker compose ps        # postgres, redis, backend, frontend
```

- Frontend: `http://<host>:5173`
- Backend (REST + MCP): `http://<host>:8000` — `/health`, `/docs`, `/mcp`
- Para mudar a porta do backend: `BACKEND_PORT=18000 docker compose up -d`

O entrypoint do backend roda `alembic upgrade head` + `python -m app.seed` a cada boot (idempotente).

## Deploy e rollback em produção

O GitHub Actions **não implanta** — ele só publica as imagens no Harbor, tagueadas com o SHA curto do commit. O deploy é um ato manual, no servidor:

```bash
docker login registry.aurora.app.br     # uma vez por servidor
./deploy/deploy.sh a1b2c3d              # tag do resumo do job "Build & Push"
```

O script: puxa as imagens → `up -d` → valida `/api/health` (checando `status:ok` **e** que nenhuma dependência está `false`) e a SPA em `/`. Falhou? **reverte sozinho** para a versão anterior e revalida.

| Situação | Comportamento |
|---|---|
| Tag não existe no Harbor / sem login | Aborta **antes** de tocar na stack |
| Stack nova não sobe ou falha no smoke | Reverte para a versão anterior, revalida, sai `1` |
| Versão anterior não identificável (stack parada, ou rodando `:latest`) | Não reverte; instrui a reversão manual |
| `deploy.sh latest` | Recusado — `latest` é alias móvel e apaga o alvo do rollback |

**Rollback** = implantar uma tag anterior (são imutáveis): `./deploy/deploy.sh 9f8e7d6`.

Com o webhook do Harbor ativo (`deploy/webhook.py`), o deploy dispara sozinho ao publicar uma release — o `deploy.sh` acima continua sendo o caminho manual e o de rollback. Estado do automático:

```bash
systemctl status aurora-webhook
journalctl -u aurora-webhook -f          # acompanha um deploy em andamento
curl http://localhost:9000/health
```

Se uma release publicou no Harbor mas nada aconteceu em produção, olhe o log nesta ordem: chegou o evento (`evento backend:<sha> -> ...`)? ficou preso em `aguardando as 3 imagens` (push incompleto ou sem permissão de pull)? ou o `deploy.sh` falhou e reverteu?

`PROXY_PORT` precisa estar fixado no `.env` do servidor. O smoke test descobre a porta via `docker compose port` (não pelo `.env`) justamente porque já houve caso do proxy ficar `Up`, o Caddy logar `server running` e **nenhuma porta ser publicada** por colisão com outro stack.

### Atualizar os scripts do servidor (deploy.sh / compose / webhook)

O webhook e o `deploy.sh` atualizam **apenas as imagens** (`docker compose pull` da tag SHA). Os arquivos versionados do lado do servidor — `deploy/deploy.sh`, `docker-compose.harbor.yml`, `deploy/webhook.py` — só mudam com um `git pull`:

```bash
cd /opt/aurora-net-tools
git fetch origin && git reset --hard origin/main   # traz deploy/ e compose atualizados
sudo systemctl restart aurora-webhook              # só se webhook.py/.service mudaram
```

**Nunca** copie a pasta `deploy/` para dentro do diretório da app (`cp -r deploy …`): se o destino já existir, ela vira `deploy/deploy/…` e o `deploy.sh` passa a resolver a raiz errada. A pasta `deploy/` chega ao servidor pelo próprio checkout git — não precisa (nem deve) ser copiada. O `deploy.sh` agora **recusa** esse layout aninhado com erro explícito.

Para (re)instalar/atualizar tudo do lado do servidor de uma vez — checkout via git, segredo, unit systemd e serviço — use o instalador idempotente (reexecutar não troca o segredo):

```bash
sudo deploy/install.sh
```

## Variáveis de ambiente críticas (`.env`)

| Var | Papel | Observação |
|-----|-------|------------|
| `APP_SECRET_KEY` | Chave Fernet que cifra **todos** os segredos | **Nunca rotacione sem re-cifrar** as credenciais — perda = segredos ilegíveis |
| `JWT_SECRET` | Assinatura dos tokens | Rotacionar desloga todos |
| `JWT_EXPIRE_MINUTES` | Vida do access token (default 15) | Curto; renovado via `refresh_token` |
| `JWT_REFRESH_EXPIRE_DAYS` | Vida do refresh no Redis (default 7) | Logout / reset / logout-all invalidam |
| `COOKIE_SECURE` | Flag Secure nos cookies | `true` com HTTPS no browser |
| `COOKIE_SAMESITE` | SameSite dos cookies | `lax` (padrão) / `strict` / `none` |
| `CORS_ORIGINS` | Allowlist CORS com credentials | Vazio = same-origin via proxy |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Seed do admin | Senha só é usada no 1º boot |
| `TL1_HOST/PORT/USERNAME/PASSWORD` | Seed do controller UNM2000 | Migra p/ credencial cifrada no 1º boot |
| `POSTGRES_*` | Banco | `pgdata` é um volume nomeado |

## Rede / acesso aos equipamentos (decisão §12)

- Padrão: **bridge**. O host Docker precisa **rotear** para a rede de gerência (TL1 `:3337`, SSH `:22`, Telnet `:23`, SNMP `:161/udp`).
- Se os equipamentos **restringem por IP de origem**, edite `docker-compose.yml` no serviço `backend`: comente `ports` e habilite `network_mode: host`.
- Teste rápido de alcance: na UI, **Controllers → Testar TL1** e **device → Testar conectividade**.

## Segurança

- Segredos cifrados em repouso (Fernet) e **mascarados** (`********`) em toda resposta da API.
- **Read-only**: a camada de driver recusa escrita por allowlist default-deny. Toda execução (inclusive bloqueios) vai para `audit_log` (tela **Atividade**).
- JWT em cookies **HttpOnly** + **SameSite** (`aurora_at` / `aurora_rt`); o SPA não guarda token em `localStorage`. Mutações só-cookie exigem `X-Aurora-Client: web` (CSRF). Access curto (`jti` + denylist Redis); `token_version` para logout-all / reset / desativação.
- **CORS**: same-origin via proxy. Em dev cross-origin (Vite), defina `CORS_ORIGINS`.
- Em produção: sirva atrás de TLS (reverse proxy), troque as senhas do `.env`, e não exponha a porta 8000 publicamente (o frontend já faz proxy de `/api` e `/mcp`).

## Observabilidade

- Logs JSONL + UI Master em **Observabilidade** (`LOG_DIR`).
- **Prometheus:** `GET /api/metrics` (RED + `aurora_dependency_up` postgres/redis). Desliga com `METRICS_ENABLED=false`.
- **Health:** `GET /api/health` → `status: ok|degraded`.
- **Alertas leves:** veja [`monitor/README.md`](monitor/README.md) (Uptime Kuma opcional via `docker-compose.monitor.yml`).

## Banco de dados

```bash
# Backup
docker compose exec postgres pg_dump -U aurora aurora > backup_$(date +%F).sql
# Restore
cat backup.sql | docker compose exec -T postgres psql -U aurora aurora
# Migrações manuais
docker compose exec backend alembic upgrade head
docker compose exec backend alembic revision --autogenerate -m "mudança"
```

## Testes

```bash
# Requer o serviço postgres no ar; cria/usa o banco aurora_test
docker compose up -d postgres
docker compose run --rm --no-deps --entrypoint "" backend pytest -q
```

## MCP (assistentes de IA)

Endpoint streamable-http em `http://<host>:8000/mcp` (ou via frontend `:5173/mcp`). Tools read-only: `listar_devices`, `buscar_device`, `executar_comando`, `snmp_get`, `snmp_walk`, `listar_olts`, etc. A política read-only e a auditoria valem igual para a IA.

## Problemas comuns

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| `/health` → `database:false` | Postgres subindo | aguardar healthcheck; ver `docker compose logs postgres` |
| `502` em exec/snmp | equipamento inalcançável / ACL por origem | testar rota; considerar `network_mode: host` |
| `409` em exec | execução concorrente no mesmo device (lock Redis) | repetir após concluir a anterior |
| `400` "nenhuma credencial" | device e grupo sem credencial p/ o protocolo | atribuir perfil de credencial |
| OLTs demoram ~30s | consulta TL1 ao vivo | normal; 2ª chamada vem do cache (TTL) |
| seed não cria admin | `ADMIN_PASSWORD` vazio | definir no `.env` e reiniciar backend |
| `deploy.sh`: "proxy não publicou a porta 8090" | colisão de porta no host | `ss -ltnp \| grep 8090`; ajustar `PROXY_PORT` no `.env` |
| build do backend: `mibs:1 not found` | imagem-base das MIBs ausente/sem login no Harbor | `docker login registry.aurora.app.br`; ver `backend/mibs.Dockerfile` |
