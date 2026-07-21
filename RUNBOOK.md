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

`PROXY_PORT` precisa estar fixado no `.env` do servidor. O smoke test descobre a porta via `docker compose port` (não pelo `.env`) justamente porque já houve caso do proxy ficar `Up`, o Caddy logar `server running` e **nenhuma porta ser publicada** por colisão com outro stack.

## Variáveis de ambiente críticas (`.env`)

| Var | Papel | Observação |
|-----|-------|------------|
| `APP_SECRET_KEY` | Chave Fernet que cifra **todos** os segredos | **Nunca rotacione sem re-cifrar** as credenciais — perda = segredos ilegíveis |
| `JWT_SECRET` | Assinatura dos tokens | Rotacionar desloga todos |
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
- JWT obrigatório em todas as rotas exceto `/auth/login` e `/health`.
- **CORS**: hoje `allow_origins=["*"]`. Em produção, restrinja a `app/main.py` ao host do frontend.
- Em produção: sirva atrás de TLS (reverse proxy), troque as senhas do `.env`, e não exponha a porta 8000 publicamente (o frontend já faz proxy de `/api` e `/mcp`).

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
