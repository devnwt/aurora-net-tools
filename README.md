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

## Publicar imagens no Harbor

Imagens self-contained (backend com MIBs, frontend com Caddy). Registry: `registry.aurora.app.br/aurora-nettools`.

```bash
docker login registry.aurora.app.br
./push-harbor.sh            # build + push, tag latest
./push-harbor.sh v1.0.0     # tag específica
```

## Deploy no servidor (pull do Harbor)

Copie `docker-compose.harbor.yml` e um `.env` para o servidor (use o [`.env.example`](./.env.example) como base; gere segredos com `openssl rand -hex 32`).

```bash
docker login registry.aurora.app.br
docker compose -f docker-compose.harbor.yml pull
docker compose -f docker-compose.harbor.yml up -d
```

- App em `http://SERVIDOR:${PROXY_PORT}` (padrão **8090**). Só o proxy é exposto; o backend fica interno.
- **Primeiro acesso:** usuário `admin` / senha = `ADMIN_PASSWORD` do `.env`.

## Notas importantes

- **`APP_SECRET_KEY` é definitiva** — cifra os segredos no banco (SMTP/S3/LLM/credenciais). Trocar depois do 1º boot torna-os ilegíveis. Guarde-a.
- **Globais (só o Master edita em Super Admin → `/admin`):** SMTP, LLM, MinIO/S3, Copilot Tools, cadastro público. **Por ORG (Settings):** FTP.
- **MIBs** (`backend/mibs/`, ~339 MB) ficam **fora do git** (`.gitignore`) para o repo não pesar; o build da imagem lê do disco. Em uma máquina limpa, provisione a pasta antes de buildar.
- **Segredos fora do git:** `.env`, `.env.prod` etc. são ignorados; só `.env.example` é versionado.

## Estrutura

- `backend/` — FastAPI (REST + MCP), drivers, modelos, Alembic, seed, `mibs/`.
- `frontend/` — React + Vite + Tailwind; `Dockerfile`/`Caddyfile` (Caddy serve o SPA).
- `proxy/` — Caddy (`Caddyfile` + `Dockerfile`), proxy da aplicação.
- `docker-compose.example.yml` — modelo de dev (com `build:` + `image:` do Harbor); copie para `docker-compose.yml` (ignorado no git).
- `docker-compose.harbor.yml` — deploy pull-based (só `image:`).
- `push-harbor.sh` — build + push das imagens.
