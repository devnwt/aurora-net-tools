# Aurora Prisma NetTools

Plataforma multi-tenant de suporte e automação de rede (MikroTik/RouterOS, Fiberhome/UNM2000 via TL1, SSH/Telnet/SNMP) com painel web, **Copilot** (LLM com tool-calling), MCP server built-in e Super Admin. Design e decisões em [`SPEC.md`](./SPEC.md); histórico em [`SPRINT.md`](./SPRINT.md); operação em [`RUNBOOK.md`](./RUNBOOK.md).

## Arquitetura

| Serviço | Imagem | Papel |
|---|---|---|
| `proxy` | Caddy | Ponto de entrada único; roteia `/api` e `/mcp` → backend, resto → frontend (SPA). |
| `frontend` | Caddy | Serve o build do SPA (React/Vite). |
| `backend` | FastAPI | REST + MCP no mesmo processo; drivers, poller, Alembic, seed. MIBs embutidas na imagem. |
| `postgres` | postgres:16 | Banco. |
| `redis` | redis:7 | Cache/locks. |

## Desenvolvimento

```bash
cp .env.example .env                          # preencha APP_SECRET_KEY, JWT_SECRET, ADMIN_PASSWORD
cp docker-compose.example.yml docker-compose.yml   # ajuste portas/rede ao seu ambiente
BACKEND_PORT=8001 PROXY_PORT=8095 docker compose up -d --build
```

> `.env` e `docker-compose.yml` ficam **fora do git** (são por-ambiente). Versionamos apenas os modelos `.env.example` e `docker-compose.example.yml`.

- App (via proxy Caddy): http://localhost:8095
- Backend direto (debug): http://localhost:8001 — `/health`, `/docs`

O entrypoint roda `alembic upgrade head` + `app.seed` a cada boot (cria o admin Master se `ADMIN_PASSWORD` estiver definido).

## Arquitetura de CI/CD

Três etapas **separadas**, sem que o GitHub Actions toque no servidor de produção:

```
PR / push develop ──▶ CI (ci.yml)                    lint + testes            ubuntu-latest
                                                                                    │
push main ──────────▶ Build & Push (build-push.yml)  CI ▸ build ▸ Harbor      ubuntu-latest
                                                                                    │
                                                     (publica  <sha-curto>  +  latest)
                                                                                    │
                                          webhook PUSH_ARTIFACT  │
                                                                 ▼
no servidor ────────▶ deploy/webhook.py ──▶ deploy/deploy.sh <sha>                prod
                                            pull ▸ up ▸ smoke ▸ rollback
```

O Actions **publica imagens; não implanta.** Quem coloca uma versão no ar é o servidor, reagindo ao webhook do Harbor (ou você, à mão, com `deploy/deploy.sh <sha>`). Isso mantém o pipeline independente de runner self-hosted e o acesso a produção fora do GitHub — o GitHub nunca fala com o servidor; o servidor é que escuta o registry.

### 1. Publicar imagens no Harbor

Automático a cada push na `main` (o job só roda se lint e testes passarem). Manualmente:

```bash
docker login registry.aurora.app.br
./push-harbor.sh                            # tag latest
PUSH_LATEST=1 ./push-harbor.sh a1b2c3d      # tag imutável + move 'latest'
```

Requer os secrets `HARBOR_USERNAME` e `HARBOR_PASSWORD` no repositório (Settings → Secrets and variables → Actions).

### 2. Implantar no servidor (pull do Harbor)

O servidor precisa de `docker-compose.harbor.yml`, `deploy/deploy.sh` e um `.env` de produção lado a lado (use o [`.env.example`](./.env.example) como base; gere segredos com `openssl rand -hex 32`).

```bash
docker login registry.aurora.app.br
./deploy/deploy.sh a1b2c3d      # a tag que o job "Build & Push" publicou
```

O script puxa as imagens, sobe a stack e valida `/api/health` + a SPA. **Se a validação falhar, ele reverte sozinho** para a versão que estava rodando. Se a tag não existir no Harbor, aborta antes de tocar em produção.

- App em `http://SERVIDOR:${PROXY_PORT}` (padrão **8090**). Só o proxy é exposto; o backend fica interno.
- **Primeiro acesso:** usuário `admin` / senha = `ADMIN_PASSWORD` do `.env`.

### 2b. Deploy automático (webhook do Harbor)

Com o receptor instalado, publicar no Harbor já implanta — sem passo manual e sem dar ao GitHub qualquer acesso a produção.

**No servidor** (ver cabeçalho de [`deploy/aurora-webhook.service`](./deploy/aurora-webhook.service) para os comandos exatos): instale o unit, gere o segredo em `/etc/aurora/webhook.env` e suba com `systemctl enable --now aurora-webhook`.

**No Harbor** → projeto `aurora-nettools` → *Webhooks* → **NEW WEBHOOK**:

| Campo | Valor |
|---|---|
| Notify Type | `http` |
| Event Type | **Artifact pushed** |
| Endpoint URL | `http://SEU-SERVIDOR:9000/harbor-webhook` |
| Auth Header | o valor de `AURORA_WEBHOOK_SECRET` |

O receptor lida com o que o Harbor tem de inconveniente:

- **Ignora tudo que não é release** — `latest`, outros repositórios (`mibs`), outros namespaces e eventos que não sejam push.
- **Um deploy por release.** O `push-harbor.sh` publica 3 repositórios × 2 tags, então o Harbor dispara vários eventos para a mesma versão; eles são coalescidos.
- **Espera a stack inteira.** O push dos 3 repositórios não é atômico — o evento do `backend` costuma chegar antes de `frontend` e `proxy` existirem. O deploy só começa quando as três imagens da tag estiverem no registry (timeout de 15 min).
- **Falha não marca como implantada**, então um novo push da mesma tag tenta de novo.

Logs: `journalctl -u aurora-webhook -f`. Saúde: `curl http://SEU-SERVIDOR:9000/health`.

> O endpoint dispara deploy em produção: exponha só para o Harbor (firewall/rede interna) e nunca sem o `Auth Header`. O serviço se recusa a iniciar sem segredo configurado.

### 3. Rollback

As tags são o SHA curto do commit e **imutáveis** — voltar versão é implantar uma tag anterior:

```bash
./deploy/deploy.sh 9f8e7d6
```

Nunca implante `latest` em produção: por ser um alias móvel, ela impede saber qual versão está no ar e apaga o alvo do rollback automático. O `deploy.sh` recusa.

## Notas importantes

- **`APP_SECRET_KEY` é definitiva** — cifra os segredos no banco (SMTP/S3/LLM/credenciais). Trocar depois do 1º boot torna-os ilegíveis. Guarde-a.
- **Globais (só o Master edita em Super Admin → `/admin`):** SMTP, LLM, MinIO/S3, Copilot Tools, cadastro público. **Por ORG (Settings):** FTP.
- **MIBs** (`backend/mibs/`, ~339 MB) ficam **fora do git** (`.gitignore`) para o repo não pesar. O build do backend **não** as lê do disco: elas vêm da imagem-base `aurora-nettools/mibs:<n>` no Harbor (ver [`backend/mibs.Dockerfile`](./backend/mibs.Dockerfile)), o que permite buildar em qualquer runner limpo. Ao atualizar as MIBs, publique numa tag **nova** e aponte o `ARG MIBS_IMAGE` do `backend/Dockerfile` — sobrescrever uma tag existente mudaria retroativamente imagens antigas e quebraria o rollback.
- **Segredos fora do git:** `.env`, `.env.prod` etc. são ignorados; só `.env.example` é versionado.

## Estrutura

- `backend/` — FastAPI (REST + MCP), drivers, modelos, Alembic, seed, `mibs/`.
- `frontend/` — React + Vite + Tailwind; `Dockerfile`/`Caddyfile` (Caddy serve o SPA).
- `proxy/` — Caddy (`Caddyfile` + `Dockerfile`), proxy da aplicação.
- `docker-compose.example.yml` — modelo de dev (com `build:` + `image:` do Harbor); copie para `docker-compose.yml` (ignorado no git).
- `docker-compose.build.yml` — **versionado**: definição de build usada pelo `push-harbor.sh`/CI (sem `.env`, sem portas, sem banco).
- `docker-compose.harbor.yml` — deploy pull-based (só `image:`).
- `push-harbor.sh` — build + push das imagens (não implanta).
- `deploy/deploy.sh` — deploy no servidor a partir do Harbor, com smoke test e rollback automático.
- `deploy/webhook.py` + `deploy/aurora-webhook.service` — receptor do webhook do Harbor que dispara o deploy (stdlib, sem dependências).
- `.github/workflows/ci.yml` — lint + testes; reutilizado como gate pelo build.
- `.github/workflows/build-push.yml` — CI ▸ build ▸ push no Harbor (`ubuntu-latest`).
