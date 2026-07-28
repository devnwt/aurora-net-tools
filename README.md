# Aurora Prisma NetTools

Plataforma **multi-tenant** de suporte e automação de rede de ISP: acesso a MikroTik/RouterOS, Cisco, Huawei (SSH/Telnet/SNMP) e Fiberhome/UNM2000 (TL1 via EMS), com painel web, **Copilot** (LLM com tool-calling), **MCP server** built-in e **Super Admin**. Um único backend FastAPI + Postgres + Redis, servido atrás de um proxy Caddy.

> **Este README é a referência de arquitetura e lógica atual** — pensado também para alimentar outra IA que vá trabalhar no código. O [`SPEC.md`](./SPEC.md) é o design original do MVP (parte já superada: hoje há multi-tenancy, Copilot e monitoramento). Operação em [`RUNBOOK.md`](./RUNBOOK.md); histórico em [`SPRINT.md`](./SPRINT.md).

---

## 1. Serviços (runtime)

| Serviço | Imagem | Papel |
|---|---|---|
| `proxy` | Caddy | Ponto de entrada único. Roteia `/api` e `/mcp` → backend; resto → frontend (SPA). Único serviço exposto. |
| `frontend` | Caddy | Serve o build estático do SPA (React/Vite). |
| `backend` | FastAPI | REST + MCP no **mesmo processo**. Drivers de rede, poller, Alembic, seed. MIBs vêm de imagem-base. |
| `postgres` | postgres:16 | Banco (volume `pgdata`). |
| `redis` | redis:7 | Cache TTL curto + locks de conexão por device. |

O backend é um processo único que monta o app MCP (`streamable-http`) em `settings.mcp_path` (`/mcp`) e sobe o **poller** em background no `lifespan` (`app/main.py`). O entrypoint roda `alembic upgrade head` + `python -m app.seed` a cada boot (idempotente).

---

## 2. Modelo mental (a lógica central)

Três ideias organizam quase todo o código; entendê-las é entender o sistema:

1. **Tudo é read-only por padrão, e isso é garantido em um único ponto.** Todo I/O em equipamento passa por `services/runner.py`, que chama `drivers/classifier.py`. O classifier é uma **allowlist default-deny**: um comando só é `read` se casar um padrão de leitura *e* não casar nenhum de escrita — qualquer coisa desconhecida vira `write` e é **bloqueada e auditada**. Escrita real só chega ao device por dois caminhos controlados: `runner.exec_write` (comandos **construídos pelo servidor**, ex. endpoints estruturados de IP/DHCP) e o Copilot com aprovação (`propose_write`). Nada de comando de escrita arbitrário.

2. **Tudo é isolado por organização (tenant).** Quase toda tabela tem `org_id` nullable. As queries são filtradas por `tenancy.scope(...)` e cada objeto é verificado com `tenancy.owned(...)`. `org_id IS NULL` = escopo **master/global** (recursos de sistema, config global). Papel `master` **ignora** o filtro de org e enxerga tudo — inclusive as linhas NULL.

3. **Todo acesso a um device é serializado por lock no Redis.** `connlock.target_lock(kind, id)` faz `SET … NX EX 60`. Poller, usuário e Copilot competem pelo mesmo lock; quem não pega, espera ou pula (o poller cede a vez). Isso evita sessões SSH/TL1 conflitantes no mesmo equipamento.

Some a isso: **segredos cifrados em repouso** (Fernet, chave `APP_SECRET_KEY`) e **mascarados** (`********`/booleans `*_set`) em toda resposta; **auditoria** de toda execução em `audit_log`.

---

## 3. Autenticação, papéis e tenancy

**Dois mecanismos de principal** (`api/deps.py::get_current_user`):
- **JWT Bearer** (login humano): `POST /auth/login` aceita **email (case-insensitive) OU username** + senha (bcrypt, truncada a 72 bytes). Token HS256, `sub = username`, TTL `jwt_expire_minutes` (480 = 8h).
- **`X-API-Key`** (programático/MCP): chave `ak_…`, guardada só como hash SHA-256. Resolve um **User sintético** (`is_admin=True`); papel `master` se a chave é global (`org_id IS NULL`), senão `admin`. Uma chave global age como master sobre todos os tenants.

**Papéis** (`user.role`, string): `master` (sistema, `org_id` NULL), `admin` (dono da org), `operator` (usuário da org, tier mais baixo). Guards: `require_admin` = `{master, admin}`; `require_master` = só `master`.

**Enforcement de tenant** (`api/tenancy.py`) — chamar isto em endpoint novo é obrigatório, senão vaza dado cross-tenant:
- `scope(stmt, model, user)` → adiciona `WHERE org_id = user.org_id` (master não filtra).
- `owned(obj, user)` → 404 se `None` ou org divergente (master passa).
- `new_org_id(user)` → org do recurso criado (`None` para master).

**Self-service:** `forgot-password`/`reset-password` (token escopado `purpose=pwreset`, 30 min; SMTP global; resposta sempre genérica, sem enumeração de conta). Cadastro público `POST /auth/register` cria uma **nova Organization + admin**, e só funciona se `registration_enabled` (config global). MCP se auth por `X-API-Key`; sem chave, cai num sentinela `operator` com `org_id=-1` que não casa nenhum recurso (vê nada).

---

## 4. Modelo de dados (PostgreSQL, SQLAlchemy 2.0)

`org_id` abaixo é sempre `FK → organization.id (ON DELETE CASCADE)`, nullable e indexado. `TimestampMixin` = `created_at`/`updated_at` tz-aware; tabelas de log/snapshot omitem o mixin e declaram o próprio `created_at`/`ts`.

### Tenancy e acesso
- **`organization`** — o tenant. `name` único; `plan_id FK→plan (SET NULL)`; `device_limit` (override opcional do limite do plano; NULL = usa o plano).
- **`plan`** — catálogo **global** (sem `org_id`). `max_devices` (10), `max_users` (5).
- **`org_settings`** — 1 linha por org (`org_id` unique; **NULL = global/master**). Integrações com segredos Fernet: **SMTP**, **FTP**, **MinIO/S3**, **LLM** (OpenAI-compatível: `llm_base_url`, `llm_model`, `llm_api_key`), toggles de **Copilot** (web/SearXNG, filesystem), e o **cadastro público** (`registration_enabled`, `registration_plan_id`) que vive na linha NULL.
- **`user`** — `username`/`email` únicos, `password_hash` bcrypt, `is_admin`, `role`, `org_id`, `usergroup_id FK→user_group (SET NULL)`.
- **`user_group`** — grupos aninháveis de usuários (`parent_id` self-FK).
- **`api_key`** — `prefix` (ex. `ak_AbC123`), `key_hash` sha256 unique, `last_used_at`.

### Inventário de rede
- **`credential`** — perfil reutilizável. `kind` (`ssh|telnet|snmp|api|tl1`), `username`, `secret` **cifrado** (senha/community/token), campos SNMP v3 (`snmp_version`, auth/priv protocol + `snmp_v3_priv_secret` cifrado).
- **`device_group`** — também é a entidade **"Site"**. `name`, `location`, geo (`latitude`/`longitude`), e 4 credenciais-padrão herdáveis (`default_{ssh,telnet,snmp,api}_credential_id`).
- **`rack`** — hierarquia Site→Rack→Device (`site_id FK→device_group CASCADE`). **`rack_link`** — enlace físico entre racks (`rack_a_id`/`rack_b_id`, `iface_a`/`iface_b`).
- **`controller`** — EMS/controladora (ex. Fiberhome **UNM2000**). `kind` (`fiberhome_unm2000`), `host`, `port` (TL1 3337), `credential_id`. **OLTs/ONUs não são linhas** — são derivadas ao vivo por TL1.
- **`device`** — equipamento de acesso direto. `device_type` (`routeros|huawei|cisco`), `connection_mode` (`direct`), `group_id`, `rack_id`, geo, e por-protocolo `{ssh,telnet,snmp,api}_enabled/_port/_credential_id`. **Resolução de credencial:** a do device → senão a default do grupo → senão erro claro.

### Execução, monitoramento e automação
- **`audit_log`** (sem mixin) — toda execução: `actor` (`user:<id>` ou `mcp`), `target_kind`/`target_id`, `protocol`, `command`, `classification` (`read|write`), `ok`, `error`, `duration_ms`, `output_summary`.
- **`device_status`** (1 por device, upsert do poller) — snapshot para o painel ler sem tocar no equipamento: `status` (`online|not_accessible|disabled|unknown`), `cpu_load`, `ram_used_pct`, `temperature`, `uptime`, `version`, `board`, `current_firmware`, `upgrade_firmware`, `error`, `checked_at`. Métricas como **string** (exibição).
- **`device_sample`** (N por device) — série temporal para gráficos: `ts`, `cpu_load`/`ram_used_pct` (int), `temperature` (float). Podado após `sample_retention_days` (30).
- **`device_backup`** — export de config RouterOS (`content` texto, `size`).
- **`command_template`** — comandos/script reutilizáveis (`type` `commands|script`, `category`, `body`, `enabled`).
- **`webhook`** — notificação HTTP de saída. `url`, `events` (CSV; vazio = todos), `secret` (assina o corpo com HMAC-SHA256), `enabled`.

### Copilot (chat/agente sobre LLM)
- **`copilot_conversation`** — sessão sobre 1+ devices. `mode` (`chat|manual|auto`), `device_ids` (JSON), `system_prompt`, `tokens_total`/`tokens_context`.
- **`copilot_message`** — turno: `role` (`user|assistant|tool`), `content`, `reasoning`, `tool_calls` (JSON), `tool_call_id`, `name`.
- **`copilot_action`** — comando proposto pela LLM: `command`, `rationale`, `classification` (`read|write`), `high_risk`, `status` (`pending|executed|failed|rejected`), `output`. Ligada à mensagem pelo `tool_call_id`.
- **`copilot_tool`** — ferramenta externa registrada **por org (master)**: `kind` (`mcp|openapi|skill`), `config` (JSON), `enabled`.

Enums (`models/enums.py`, todos `str`): `DeviceType`, `ConnectionMode`, `ControllerKind`, `CredentialKind`, `SnmpVersion`, `Protocol`, `Classification`, `TargetKind`.

---

## 5. Camada de drivers e execução

- **`drivers/classifier.py`** — o portão read/write (ver §2.1). Read: RouterOS `print|export|get|monitor|find`; Cisco/Huawei `^show|^display`. Write: `add|set|remove|delete|unset|move|enable|disable|reset|conf|no|write|copy|reload|clear`. Vazio ou desconhecido → `write` (bloqueado).
- **`services/runner.py`** — único ponto de I/O em device (REST e MCP passam por aqui):
  - `exec_command` — classifica; write → audita bloqueado + `WriteBlocked`; read → resolve credencial, pega lock, roda SSH/Telnet, audita.
  - `exec_many` — vários reads numa sessão/lock; bloqueia o lote se algum for write.
  - `exec_write` — **só comandos construídos pelo servidor** (endpoints estruturados). Roda, parseia a saída RouterOS por marcadores de erro (`failure`, `no such item`, `invalid`…), audita como `write`.
  - `exec_snmp` — get/walk, sempre read.
- **`services/connlock.py`** — `target_lock` (Redis `SET NX EX 60`), `TargetBusy` se ocupado. **`services/cache.py`** — `cached(key, ttl, producer)` (get-or-produce JSON).
- **Drivers concretos** (`drivers/`): `ssh.py`/`telnet.py` (netmiko, `device_type`→`mikrotik_routeros`/`cisco_ios`/`huawei`; paramiko/telnetlib fallback), `snmp.py` (net-snmp `snmpget`/`snmpbulkwalk` via subprocess, resolvendo por MIB), `routeros.py`, `fiberhome.py` (TL1, `LST-*`/`QUERY-*` no controller; verbos de escrita existem mas ficam bloqueados).

---

## 6. Subsistemas de background e integração

- **Poller** (`services/poller.py`) — a cada `poll_interval_seconds` (60), com `Semaphore(poll_concurrency=4)`, varre todos os devices `routeros`, roda board+health numa sessão SSH (preferido; senão Telnet; senão `disabled`), faz upsert de `device_status` e append de `device_sample`. **Não audita** (automático), **cede o lock** ao usuário (pula em `TargetBusy`), e em transição de estado dispara webhooks `device.online`/`device.offline`. Falhas nunca quebram o loop.
- **Scan de rede** (`services/scan.py`, `POST /scan`) — descobre RouterOS num range (CIDR/faixa/IP, cap `MAX_HOSTS=512`). Duas fases com `Semaphore(48)`: TCP-connect na porta SSH (timeout 1.5s) → netmiko em portas abertas lendo identity/resource. Recebe credencial no corpo; **só exige estar logado** (não é restrito por papel).
- **Webhooks de saída** (`services/webhooks.py`) — `dispatch(event, payload, org_id)` seleciona webhooks da org **OU globais (NULL)**, filtra por `events`, faz fan-out `asyncio.gather` (timeout 8s, best-effort). Assina `X-Aurora-Signature: sha256=HMAC(secret, body)` quando há segredo; sempre manda `X-Aurora-Event`. Rotas `require_admin`.
- **Observabilidade** (`core/logging.py` → `services/observability.py` → `api/observability.py`) — os logs da aplicação são gravados em **JSONL** (`log/events.jsonl`, bind mount de `/app/log`, rotação 10 MB × 5) além do stdout. O middleware de `main.py` abre um contexto (`request_id`, método, rota) que todo log da requisição herda; `get_current_user` completa com usuário/ORG. **Nada disso pode afetar a aplicação:** a escrita fica atrás de um `QueueHandler` de fila limitada (descarta sob pressão, nunca bloqueia), `logging.raiseExceptions = False`, e sem disco gravável o app sobe igual — só a aba fica vazia. Senhas, tokens, JWTs, `Authorization`, credenciais em DSN e a parte local de e-mails são **redigidos nos dois canais** (arquivo e stdout). A leitura (`/observability/*`, `require_master`) é feita em thread separada, do fim do arquivo para trás e com teto de varredura. Aparece na aba **Observabilidade** de `/logs`, **só para o Master**.
- **Settings global × org** (`api/settings.py`) — **só FTP é por-org** hoje. **SMTP, LLM, MinIO/S3 e Copilot Tools são globais** (Super Admin → `/admin`, linha `org_settings` com `org_id IS NULL`). Segredos cifrados na escrita, `""` limpa, nunca retornam (só `*_set`). `POST /settings/poll` dispara um `poll_once()` imediato.

---

## 7. Copilot (LLM com tool-calling)

`services/copilot.py` + `api/copilot.py`. Cliente **genérico OpenAI-compatível** (`/chat/completions`, streaming SSE, lê `reasoning_content` de modelos R1-like); config **global** (`llm_*` na linha NULL, `_require_llm`), temperatura 0.2.

**Modos:** `chat` (sem tools) · `manual` (tools; escrita exige aprovação do operador) · `auto` (tools; escrita auto-executa **exceto high-risk**).

**Tools expostas:** estáticas de device (`run_read_command`, `get_device_facts`, `list_templates`, `propose_write`); built-in globais (`web_search` via SearXNG; `fs_list/read/write` sob raiz configurável, default `/tmp`, cap 200 KB); externas de `copilot_tool` (MCP → prefixo `mcp_`; OpenAPI → `oapi_`; Skills → injetadas no system prompt).

**Portões (críticos):**
- `_device_for` — o `device_id` da tool call precisa estar em `conv.device_ids` **e** pertencer à org (ou master). Este é o gate de tenant dentro do agente.
- Reads rodam já (via runner). `propose_write` → `classify_command`: se `read`, roda; se `write`, cria `CopilotAction`.
  - `is_high_risk` (denylist regex: `reset-configuration`, `/system reset|reboot|shutdown`, `/user remove|disable`, disable de interface, firewall input drop…) → **sempre pending, mesmo em auto**.
  - `auto` + não-high-risk → executa (`runner.exec_write`). `manual` ou high-risk → fica `pending` e **suspende o loop** (sem tool message).

**Loop:** `advance`/`advance_stream` iteram até `MAX_ITERS=6`; suspendem se há tool call sem resposta (aprovação pendente). `resume_action` (approve/reject) executa/rejeita e retoma. Tokens acumulados na conversa. SSE abre `SessionLocal` própria e seta `X-Accel-Buffering: no`.

> **Superfícies de risco (todas master-only por design):** `fs_write` grava sob raiz configurável (traversal bloqueado por realpath); `web_search`/OpenAPI/MCP fazem chamadas de saída a URLs configuradas pelo master (SSRF). Tudo que toca device é auditado pelo runner.

---

## 8. MCP server (built-in, tenant-scoped)

`mcp/server.py` — `FastMCP("aurora-nettools")` montado em `/mcp`. **Reusa o runner**, então a política read-only e a auditoria valem idênticas para a IA (actor `"mcp"`). Auth por `X-API-Key` (ASGI middleware → `ContextVar` com o principal; chave NULL = master). Tools: `health`; inventário (`listar_grupos/controllers/devices`, `buscar_device`); `executar_comando` (read-only), `snmp_get/snmp_walk`; e a suíte TL1 read-only do UNM2000 no nível OLT (list/info OLTs, boards, PONs, ONUs, não-registradas, alarmes) e ONU (locate, estado, sinal óptico DDM, LAN, WAN, MAC table, VLAN). Detalhe da API REST equivalente em [`SPEC.md`](./SPEC.md) §5–6.

---

## 9. Frontend (React + Vite + TS + Tailwind)

SPA com **tema dark OLED**. Providers: `AuthProvider → ToastProvider → ConfirmProvider` (`src/main.tsx`).

- **Auth** (`lib/auth.tsx`): `useAuth() = {user, loading, login, logout}`. Token em `localStorage[aurora_token]`; hidrata via `GET /auth/me`. `Me = {id, username, is_admin, role, org_id}`.
- **API client** (`lib/api.ts`): base `VITE_API_BASE ?? "/api"`; anexa `Authorization: Bearer`; **401 → limpa token e vai pra `/login`** (exceto no login). `ApiError extends Error` carrega `status`. Métodos `get/post/put/patch/del/postStream` (SSE do Copilot) + `login` (form OAuth2; só 401 = "senha errada", outros status = mensagem distinta).
- **Rotas** (`main.tsx`): `/login`, `/register`, `/reset-password` públicas; resto atrás de `<Protected>` + `<Layout>`. **Gating é só de visibilidade no nav** (`adminOnly` = `is_admin`; `masterOnly` = `role==="master"`) — as rotas em si só exigem autenticação.
- **Design tokens** (`tailwind.config.js`, `darkMode: class`): `bg #0A0E14`, `surface #11161F`, `surface-2 #171E2A`, `border #1F2937`, `primary #3B82F6`, `accent #F59E0B`, `muted #94A3B8`, `text #E2E8F0`, `ok #22C55E`, `danger #EF4444`. Fontes Fira Sans/Fira Code, radius `lg 0.6rem`. Toasts no canto superior direito (`lib/toast.tsx`, variantes error/success/warning/info).
- **i18n** (`src/i18n/`, i18next + react-i18next): 3 idiomas — **pt-BR** (padrão/fallback), **en**, **es**. Traduções em `locales/<idioma>/<namespace>.json` (carregadas por glob — adicionar namespace/idioma não exige fiação). Uso: `const { t } = useTranslation(); t("<namespace>:<chave>")`. Seletor em **Configurações → Preferências**, troca ao vivo sem reload, persiste em `localStorage["aurora_lang"]`. Guia completo em [`src/i18n/README.md`](./frontend/src/i18n/README.md). Não se traduz saída de equipamento, comandos (RouterOS/Cisco/Huawei/TL1), nomes de protocolo nem mensagens técnicas do backend.

**Páginas** (nav agrupado em Layout.tsx):
- *Visão geral:* **Dashboard** (painel), **Devices**, **DeviceDetail** (view ao vivo: interfaces, OSPF/MPLS, IP/DHCP/rotas), **DeviceForm**, **Sites**, **Racks** (Site→Rack→Device + mapa/links).
- *Ações:* **Copilot** (SSE), **Commands** (massa), **Templates**, **Upgrades** (firmware RouterOS), **ScanNetwork**, **Topology**, **Backups** (`/export`), **Logs** (`/log print`), **Security** (hardening RouterOS: ok/warn/fail).
- *Fiberhome:* **Controllers**, **OltExplorer** (TL1 ao vivo).
- *Admin:* **Admin** (Super Admin, `masterOnly`: orgs/planos/config global).
- *Sistema:* **Activity** (audit trail), **Credentials**, **Users** (`adminOnly`), **ApiKeys** (`adminOnly`), **Webhooks** (`adminOnly`), **Settings**.

> Pages legadas não roteadas: `AdminOrgs`, `AdminPlans`, `Groups`, `Inventory` (fundidas no `Admin`).

---

## 10. Desenvolvimento

```bash
cp .env.example .env                               # preencha APP_SECRET_KEY, JWT_SECRET, ADMIN_PASSWORD
cp docker-compose.example.yml docker-compose.yml   # ajuste portas/rede
BACKEND_PORT=8001 PROXY_PORT=8095 docker compose up -d --build
```

- App (via proxy): http://localhost:8095 — 1º acesso `admin` / `ADMIN_PASSWORD`.
- Backend direto (debug): http://localhost:8001 — `/health`, `/docs`.

> `.env` e `docker-compose.yml` ficam **fora do git** (por-ambiente); versionamos só `.env.example` e `docker-compose.example.yml`. `APP_SECRET_KEY` é **definitiva** — cifra os segredos no banco; trocar depois do 1º boot os torna ilegíveis. Os defaults inseguros `JWT_SECRET=change-me` e `POSTGRES_PASSWORD=aurora` **precisam** ser sobrescritos em produção.

Variáveis de ambiente relevantes (`core/config.py`): `APP_SECRET_KEY` (obrigatória), `JWT_SECRET`/`JWT_EXPIRE_MINUTES` (480), `ADMIN_USERNAME/EMAIL/PASSWORD`, `POSTGRES_*`, `REDIS_URL`, `MIBS_PATH`, `POLL_ENABLED`/`POLL_INTERVAL_SECONDS` (60)/`POLL_CONCURRENCY` (4)/`SAMPLE_RETENTION_DAYS` (30), `TL1_HOST/PORT/USERNAME/PASSWORD` (seed do UNM2000).

Testes: ver [`RUNBOOK.md`](./RUNBOOK.md) (requer postgres; usa banco `aurora_test`).

---

## 11. Arquitetura de CI/CD

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

O Actions **publica imagens; não implanta.** Quem coloca uma versão no ar é o servidor, reagindo ao webhook do Harbor (ou você, à mão, com `deploy/deploy.sh <sha>`). O GitHub nunca fala com o servidor; o servidor é que escuta o registry.

### 1. Publicar imagens no Harbor

Automático a cada push na `main` (só roda se lint e testes passarem). Manualmente:

```bash
docker login registry.aurora.app.br
./push-harbor.sh                            # tag latest
PUSH_LATEST=1 ./push-harbor.sh a1b2c3d      # tag imutável + move 'latest'
```

Requer os secrets `HARBOR_USERNAME` e `HARBOR_PASSWORD` no repositório.

### 2. Implantar no servidor (pull do Harbor)

O servidor precisa de `docker-compose.harbor.yml`, `deploy/deploy.sh` e um `.env` de produção lado a lado.

```bash
docker login registry.aurora.app.br
./deploy/deploy.sh a1b2c3d      # a tag que o job "Build & Push" publicou
```

O script puxa as imagens, sobe a stack e valida `/api/health` + a SPA. **Se falhar, reverte sozinho** para a versão anterior. Se a tag não existir no Harbor, aborta antes de tocar em produção. App em `http://SERVIDOR:${PROXY_PORT}` (padrão **8090**); só o proxy é exposto.

### 2b. Deploy automático (webhook do Harbor)

Com o receptor instalado, publicar no Harbor já implanta — sem passo manual e sem dar ao GitHub acesso a produção.

**No servidor** (comandos exatos no cabeçalho de [`deploy/aurora-webhook.service`](./deploy/aurora-webhook.service)): instale o unit, gere o segredo em `/etc/aurora/webhook.env`, suba com `systemctl enable --now aurora-webhook`.

**No Harbor** → projeto `aurora-nettools` → *Webhooks* → **NEW WEBHOOK**: Notify Type `http`, Event Type **Artifact pushed**, Endpoint `http://SEU-SERVIDOR:9000/harbor-webhook`, Auth Header = valor de `AURORA_WEBHOOK_SECRET`.

O receptor (`deploy/webhook.py`, só stdlib) lida com o que o Harbor tem de inconveniente:
- **Ignora tudo que não é release** — `latest`, outros repositórios (`mibs`), outros namespaces, eventos que não sejam push.
- **Um deploy por release.** O `push-harbor.sh` publica 3 repositórios × 2 tags → vários eventos p/ a mesma versão; são coalescidos.
- **Espera a stack inteira.** O push dos 3 não é atômico; o deploy só começa quando `backend`, `frontend` e `proxy` da tag existirem no registry (timeout 15 min).
- **Falha não marca como implantada** → novo push da mesma tag tenta de novo. Responde `202` na hora (o deploy leva minutos; segurar a conexão faria o Harbor reenviar).

Logs: `journalctl -u aurora-webhook -f`. Saúde: `curl http://SEU-SERVIDOR:9000/health`.

> O endpoint dispara deploy em produção: exponha só para o Harbor (firewall/rede interna) e nunca sem o `Auth Header`. O serviço se recusa a iniciar sem segredo.

### 3. Rollback

Tags são o SHA curto do commit e **imutáveis** — voltar versão é implantar uma tag anterior: `./deploy/deploy.sh 9f8e7d6`. Nunca implante `latest` em produção (alias móvel; apaga o alvo do rollback automático) — o `deploy.sh` recusa.

---

## 12. Notas importantes

- **`APP_SECRET_KEY` é definitiva** — cifra os segredos no banco (SMTP/S3/LLM/FTP/credenciais). Trocar depois do 1º boot torna-os ilegíveis. Guarde-a.
- **Global (só o Master edita em Super Admin → `/admin`):** SMTP, LLM, MinIO/S3, Copilot Tools, cadastro público. **Por ORG (Settings):** FTP.
- **MIBs** (`backend/mibs/`, ~339 MB) ficam **fora do git**. O build do backend **não** as lê do disco: vêm da imagem-base `aurora-nettools/mibs:<n>` no Harbor (ver [`backend/mibs.Dockerfile`](./backend/mibs.Dockerfile)). Ao atualizar, publique numa tag **nova** e aponte o `ARG MIBS_IMAGE` do `backend/Dockerfile` — sobrescrever uma tag existente mudaria retroativamente imagens antigas e quebraria o rollback.
- **CORS** hoje é `allow_origins=["*"]` — restrinja em produção (ver RUNBOOK).
- **Segredos fora do git:** `.env`, `.env.prod` etc. são ignorados; só `.env.example` é versionado.

---

## 13. Estrutura

```
backend/app/
  main.py              FastAPI; monta MCP em /mcp; sobe o poller no lifespan
  core/                config (settings/env), security (JWT/bcrypt/api-key), crypto (Fernet), db (async), redis, logging
  models/              tabelas SQLAlchemy 2.0 + enums.py + mixins.py (TimestampMixin)
  schemas/             Pydantic (segredos mascarados na saída)
  api/                 routers REST + deps.py (principal) + tenancy.py (scope/owned/new_org_id)
  drivers/             base, classifier (allowlist read/write), ssh, telnet, snmp, routeros, fiberhome (TL1)
  services/            runner (I/O em device), connlock (lock Redis), cache, poller, scan, copilot, webhooks, integrations, credentials, audit
  mcp/                 server (tools), auth (X-API-Key→principal), context (ContextVar)
  catalog/             catálogo curado de diagnósticos
  seed.py              admin master + controller UNM2000 do .env (idempotente)
  mibs/                MIBs (fora do git; vêm da imagem-base)
log/                   logs brutos JSONL da observabilidade (runtime; fora do git)
frontend/src/
  pages/               telas (ver §9)
  components/          Layout (nav+gating), DataTable, PageHeader, ui, mapas/gráficos
  lib/                 api (client), auth, toast, confirm, types, mikrotik/ros/tl1 helpers
proxy/                 Caddy (entrada única)
deploy/                deploy.sh (pull+smoke+rollback), webhook.py + aurora-webhook.service (deploy automático)
docker-compose.*.yml   example (dev) · build (CI/push) · harbor (deploy pull-based)
push-harbor.sh         build + push das imagens (não implanta)
.github/workflows/     ci.yml (lint+testes) · build-push.yml (CI▸build▸Harbor, ubuntu-latest)
```
