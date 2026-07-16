# Aurora Nettools — SPEC (MVP)

> Plataforma unificada de suporte e automação de equipamentos de rede de ISP, com acesso por **SSH, Telnet, SNMP** e **TL1 (via EMS)**, cadastro de equipamentos/controladores/grupos, perfis de credencial reutilizáveis, e um **MCP server built-in** para assistentes de IA. Absorve o stack Fiberhome existente como um caso particular.

Este SPEC reflete as decisões de design fechadas em entrevista (ver §13, "Registro de decisões").

---

## 1. Visão geral

Aurora Nettools é o sistema unificado de acesso à rede do NOC. Ele substitui, ao longo do tempo, o conjunto atual de peças isoladas (Sync API Fiberhome em `:20000`, MCP Fiberhome em `:8074`, Open WebUI Tool e o cache MongoDB), trazendo tudo para um único backend FastAPI + Postgres.

Duas superfícies de consumo:
- **Painel web (React)** — operadores do NOC administram inventário e rodam diagnósticos read-only.
- **MCP server built-in** — assistentes de IA (Open WebUI / clientes MCP) executam consultas e diagnósticos pelas mesmas ferramentas.

### Escopo do MVP
- CRUD de **controllers** (EMS), **devices** (acesso direto), **grupos** e **perfis de credencial**.
- Acesso **read-only**: SSH/Telnet (comandos de leitura), SNMP **get/walk**, TL1 de leitura (Fiberhome via UNM2000).
- **MCP** com ferramentas equivalentes + catálogo curado de diagnósticos.
- **Auditoria** de toda execução.
- **Auth JWT** com 1 admin (seed).

### Explicitamente fase 2 (fora do MVP)
- **Escrita/automação** (aplicar templates RouterOS/Huawei, `RESET-ONU`, config push) — com trava dupla (flag global + `confirmar=true`) e auditoria.
- **Sync engine** em background (varredura periódica → Postgres) e **busca de ONU por nome de cliente**.
- **Driver de API** (RouterOS REST primeiro; depois NETCONF/RESTCONF).
- Migração/aposentadoria definitiva da Sync API/Mongo/Open WebUI Tool atuais.

### Stack
| Camada | Escolha |
|--------|---------|
| Backend | Python + **FastAPI** (processo único; REST + MCP) |
| MCP | **FastMCP** montado em `/mcp`, transporte `streamable-http` |
| Frontend | **React + Vite + shadcn/ui + Tailwind** (skill `ui-ux-pro-max`) |
| Banco | **PostgreSQL** |
| Cache/lock | **Redis** (cache TTL curto + lock de conexão por device) |
| SNMP | **net-snmp** (`snmpget`/`snmpbulkwalk`) via subprocess |
| SSH/Telnet | **netmiko** (primário), `paramiko`/`telnetlib` (fallback) |
| Fiberhome | driver **TL1** portado de `fiberhome_tl1.py` |
| Auth | **JWT** (python-jose) + bcrypt (passlib) + admin via seed |
| Infra | **Dockerfile** (backend, frontend) + **docker-compose** |

---

## 2. Arquitetura de pastas

```
aurora-nettools/
├── backend/                       # FastAPI (REST + MCP no mesmo processo)
│   ├── app/
│   │   ├── main.py                # FastAPI; monta FastMCP em /mcp (streamable-http)
│   │   ├── core/                  # settings, security (JWT), db (SQLAlchemy async), redis
│   │   ├── models/                # Controller, Device, DeviceGroup, Credential, User, AuditLog
│   │   ├── schemas/               # Pydantic (segredos sempre mascarados na saída)
│   │   ├── api/                   # routers REST: auth, controllers, devices, groups,
│   │   │                          #   credentials, exec, snmp, audit
│   │   ├── drivers/               # camada de acesso (compartilhada por REST e MCP)
│   │   │   ├── base.py            # Driver: connect/run/close + classify(command)->read|write
│   │   │   ├── ssh.py             # netmiko/paramiko
│   │   │   ├── telnet.py          # netmiko/telnetlib
│   │   │   ├── snmp.py            # wrapper net-snmp (snmpget/snmpbulkwalk)
│   │   │   ├── routeros.py        # netmiko mikrotik_routeros + verbos de leitura
│   │   │   ├── cisco.py           # netmiko cisco_ios/xe
│   │   │   ├── huawei.py          # netmiko huawei
│   │   │   └── fiberhome.py       # TL1 (porta de fiberhome_tl1.py), modo controller
│   │   ├── mcp/                   # FastMCP: tools + catálogo de diagnósticos
│   │   ├── services/              # crypto (Fernet), exec orchestrator, classifier, snmp helper
│   │   ├── catalog/               # catálogo curado de diagnósticos por device_type
│   │   └── seed.py                # admin + controller UNM2000 (a partir do .env), idempotente
│   ├── mibs/                      # MIBs existentes (montadas no container; MIBDIRS)
│   ├── alembic/                   # migrações
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                      # React + Vite + shadcn/ui + Tailwind
│   ├── src/{pages,components,api,lib}
│   ├── Dockerfile                 # build Vite -> nginx
│   └── ...
├── docker-compose.yml             # postgres, redis, backend, frontend
├── .env.example
└── SPEC.md
```

> **Reaproveitamento de código:** `fiberhome_tl1.py` vira `drivers/fiberhome.py` (driver TL1). O padrão de retorno `_result(ok, data, error)` e a montagem `FastMCP(..., streamable_http_path="/mcp")` de `fiberhome_mcp.py` são preservados. Os `*_template.txt` vão para `app/catalog/templates/` (referência/contexto, sem execução de escrita no MVP). A pasta `mibs/` é mantida e usada pelo net-snmp.

---

## 3. Modelo de dados (PostgreSQL)

### `credential` — perfis reutilizáveis (decisão §7)
| Campo | Tipo | Notas |
|-------|------|-------|
| id | PK | |
| name | text | único (ex.: "MikroTik NOC", "SNMP noc-nwt") |
| kind | enum | `ssh` \| `telnet` \| `snmp` \| `api` \| `tl1` |
| username | text | vazio p/ SNMP v2c |
| secret | text | **cifrado (Fernet)** — senha / community / token |
| snmp_version | enum? | `v2c` (default) \| `v3` (quando kind=snmp) |
| snmp_v3_* | text? | auth/priv/protocols (opcional, v3) |
| created_at / updated_at | timestamptz | |

Segredos **nunca** retornam em texto na API — sempre `"********"` em respostas; decifrados só no momento de conectar.

### `device_group`
| Campo | Tipo | Notas |
|-------|------|-------|
| id | PK | |
| name | text | único |
| description | text | opcional |
| default_ssh_credential_id | FK→credential | herança padrão (decisão §7) |
| default_telnet_credential_id | FK→credential | |
| default_snmp_credential_id | FK→credential | |
| default_api_credential_id | FK→credential | |
| created_at | timestamptz | |

### `controller` — EMS/controladoras (decisão §2)
Representa um sistema que intermedia o acesso a muitos elementos (ex.: **UNM2000** Fiberhome).
| Campo | Tipo | Notas |
|-------|------|-------|
| id | PK | |
| name | text | |
| kind | enum | `fiberhome_unm2000` (extensível: futuro Huawei NCE etc.) |
| host | inet/text | ex.: `10.9.9.54` |
| port | int | ex.: `3337` (TL1) |
| credential_id | FK→credential | kind=`tl1` |
| created_at / updated_at | timestamptz | |

> OLTs e ONUs **não** são linhas em `device`. São derivadas ao vivo via TL1 a partir do controller (decisão §3). Na fase 2, ganham tabelas próprias (`fiberhome_olt`, `fiberhome_onu`) populadas pelo sync engine.

### `device` — equipamentos de acesso direto
| Campo | Tipo | Notas |
|-------|------|-------|
| id | PK | |
| name | text | |
| ip | inet | |
| device_type | enum | `routeros` \| `huawei` \| `cisco` (acesso direto) |
| connection_mode | enum | `direct` (no MVP, sempre `direct` p/ device) |
| group_id | FK→device_group | opcional |
| ssh_enabled / ssh_port | bool/int | porta default 22 |
| ssh_credential_id | FK→credential | opcional (senão herda do grupo) |
| telnet_enabled / telnet_port | bool/int | porta default 23 |
| telnet_credential_id | FK→credential | opcional |
| snmp_enabled / snmp_port | bool/int | porta default 161 |
| snmp_credential_id | FK→credential | opcional |
| api_enabled / api_base_url | bool/text | armazenado, **sem driver no MVP** (decisão §8) |
| api_credential_id | FK→credential | kind=`api` |
| notes | text | opcional |
| created_at / updated_at | timestamptz | |

> **Resolução de credencial:** device.credential → senão default do grupo → senão erro claro ("nenhuma credencial SSH definida").
>
> **Fiberhome:** `device_type=fiberhome` **não** existe como device. O UNM2000 é um `controller`. (Decisão §2.)

### `user`
`id`, `username` (único), `password_hash` (bcrypt), `is_admin`, `created_at`. Seed de 1 admin via `ADMIN_USERNAME`/`ADMIN_PASSWORD`.

### `audit_log` (decisão §11)
| Campo | Tipo | Notas |
|-------|------|-------|
| id | PK | |
| ts | timestamptz | |
| actor | text | `user:<id>` ou `mcp` |
| target_kind | enum | `device` \| `controller` |
| target_id | int | |
| protocol | enum | `ssh` \| `telnet` \| `snmp` \| `tl1` |
| command | text | comando/OID solicitado |
| classification | enum | `read` \| `write` (write sempre bloqueado no MVP) |
| ok | bool | |
| error | text? | |
| duration_ms | int | |
| output_summary | text | trecho/resumo da saída |

---

## 4. Camada de drivers

Interface comum (`drivers/base.py`):
```python
class Driver(Protocol):
    def classify(self, command: str) -> Literal["read", "write"]: ...
    def connect(self) -> None: ...
    def run(self, command: str) -> str: ...   # bloqueia se classify()=="write" no MVP
    def close(self) -> None: ...
```

- **Classificação read/write (decisão §13)** — **allowlist por `device_type` (default-deny)**:
  - RouterOS: leitura = `print`/`get`/`monitor`/`export`.
  - Cisco/Huawei: leitura = `show`/`display`.
  - Fiberhome TL1: leitura = `LST-*`/`QUERY-*`.
  - Qualquer comando que **não** case com a allowlist é recusado: *"escrita desabilitada nesta versão"*. (Os verbos de escrita ficam mapeados desde já, prontos para a fase 2.)
- **SSH/Telnet** — `netmiko` mapeando `device_type` → `mikrotik_routeros`/`cisco_ios`/`huawei`; `paramiko`/`telnetlib` como fallback.
- **SNMP (decisão §6)** — wrapper fino sobre net-snmp: `snmpget`/`snmpbulkwalk -v2c -c <community> -M <mibdirs> -m ALL <ip>:<port> <oid>`, parseando a saída em `[{oid, type, value}]`. **Somente leitura** (não há caminho para `snmpset`). v3 suportado via flags quando a credencial for v3.
- **Fiberhome (TL1)** — porta de `fiberhome_tl1.py`; conecta no `controller` (UNM2000), executa `LST-*`/`QUERY-*`. Reset/add/del existem no código mas ficam **bloqueados** no MVP pelo classifier.
- **Concorrência** — execuções no mesmo alvo são serializadas por **lock no Redis** (chave por `device.id`/`controller.id`) para evitar sessões conflitantes.

---

## 5. API REST (FastAPI)

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/auth/login` · GET `/auth/me` | JWT |
| CRUD | `/credentials` | perfis de credencial (segredos mascarados na saída) |
| CRUD | `/groups` | grupos + credenciais-padrão |
| CRUD | `/controllers` | EMS (UNM2000) |
| CRUD | `/devices` | equipamentos diretos |
| POST | `/devices/{id}/exec` | `{ command, protocol }` — só leitura (allowlist) |
| POST | `/devices/{id}/snmp/get` · `/snmp/walk` | `{ oid }` |
| GET | `/devices/{id}/catalog` · POST `/devices/{id}/catalog/{op}` | catálogo curado |
| GET | `/controllers/{id}/olts` · `/olts/{oltid}/onus` | Fiberhome ao vivo (TL1) |
| POST | `/devices/{id}/test` · `/controllers/{id}/test` | teste de conectividade |
| GET | `/audit` | log de auditoria (filtros) |
| GET | `/health` | saúde de serviço/DB/redis |

Tudo (exceto `/auth/login` e `/health`) exige `Authorization: Bearer <jwt>`.

---

## 6. MCP server (built-in)

`FastMCP` montado em `/mcp` no mesmo processo, padrão `_result(ok, data, error)`. Tools do MVP:
- `listar_devices(group?, device_type?)`, `buscar_device(nome|ip)`, `listar_grupos()`, `listar_controllers()`.
- `executar_comando(device, command, protocol?)` — read-only (allowlist).
- `snmp_get(device, oid)`, `snmp_walk(device, oid)`.
- **Catálogo de diagnóstico** como tools nomeados (decisão §13): `diag_system_resource`, `diag_interfaces`, `diag_routes`, `diag_snmp_uptime`, etc.
- Fiberhome ao vivo: `listar_olts(controller)`, `listar_onus_em_pon(controller, olt, ponid)`, `diagnostico_onu(controller, olt, ponid, onuid)`.
- `health()`.

Escrita e busca de ONU por nome de cliente **não** são expostas no MVP (fase 2).

---

## 7. Frontend (React + Vite + shadcn/ui + Tailwind)

Construído com a skill **`ui-ux-pro-max`**. Papel: **administração + console de diagnóstico read-only** (decisão §10). Telas:
1. **Login** (JWT).
2. **Inventário** — tabela densa de controllers + devices, filtro por grupo/`device_type`/status.
3. **Cadastro/edição de device** — nome, IP, `device_type`, grupo, abas SSH/Telnet/SNMP/API com toggles e **seleção de perfil de credencial** (ou herdar do grupo).
4. **Controllers** — cadastro do UNM2000 e futuros EMS.
5. **Credenciais** — CRUD de perfis (segredos mascarados).
6. **Grupos** — CRUD + credenciais-padrão.
7. **Console read-only** — escolher device → rodar leitura (allowlist) ou botões do catálogo → ver saída.
8. **SNMP** — get/walk por OID com resultado resolvido por MIB.
9. **Atividade** — visualização do `audit_log`.

Sem chat embutido (o lado IA fica no Open WebUI / clientes MCP).

---

## 8. Infra / Docker

- **`backend/Dockerfile`** — Python slim; `apt install snmp` (binários net-snmp); pip: `fastapi`, `uvicorn[standard]`, `sqlalchemy[asyncio]`, `asyncpg`, `alembic`, `netmiko`, `paramiko`, `mcp`/`fastmcp`, `cryptography`, `redis`, `python-jose[cryptography]`, `passlib[bcrypt]`, `pydantic-settings`; copia `mibs/` e popula `MIBDIRS` (inclui subdirs de vendor) no entrypoint.
- **`frontend/Dockerfile`** — build Vite → nginx servindo estático.
- **`docker-compose.yml`** — serviços `postgres` (volume), `redis`, `backend` (migrações no start; monta `./backend/mibs`), `frontend`.
  - **Rede (decisão §12):** **bridge** por padrão. **Se os equipamentos restringem SNMP/SSH por IP de origem, troque o backend para `network_mode: host`** (deixado documentado e comentado no compose).
- **Bootstrap (decisão §9):** `seed.py` idempotente cria o admin e o controller **UNM2000 a partir do `.env`** (`TL1_HOST/PORT/USERNAME/PASSWORD`), gravando a credencial TL1 **cifrada**.

### `.env.example`
```
# App
APP_SECRET_KEY=            # chave Fernet p/ cifrar segredos (obrigatória)
JWT_SECRET=
JWT_EXPIRE_MINUTES=480
ADMIN_USERNAME=admin
ADMIN_PASSWORD=

# Postgres
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=aurora
POSTGRES_USER=aurora
POSTGRES_PASSWORD=

# Redis
REDIS_URL=redis://redis:6379/0

# Backend / MCP
HOST=0.0.0.0
PORT=8000
MCP_TRANSPORT=streamable-http
MCP_PATH=/mcp

# SNMP
MIBS_PATH=/app/mibs

# Seed do controller Fiberhome (UNM2000) — migra para credential cifrada no 1º boot
TL1_HOST=10.9.9.54
TL1_PORT=3337
TL1_USERNAME=
TL1_PASSWORD=
```

---

## 9. Segurança

- Segredos (`credential.secret`, v3 auth/priv) **cifrados em repouso** com Fernet (`APP_SECRET_KEY`); **mascarados** em toda resposta da API.
- **Read-only** no MVP, garantido na camada de driver por **allowlist default-deny** (não denylist).
- **Auditoria** de toda execução (`audit_log`), pré-requisito da automação da fase 2.
- JWT obrigatório em todas as rotas operacionais; bcrypt para senha do admin.
- Lock no Redis evita execuções concorrentes no mesmo equipamento.

---

## 10. Roadmap de implementação

1. **Scaffold** backend (FastAPI, settings, db async, modelos, Alembic) + `docker-compose` (postgres/redis).
2. **Auth JWT** + seed admin; CRUD de `credential`, `device_group`.
3. CRUD de `controller` e `device` + resolução de credencial (device → grupo).
4. **Drivers**: SSH/Telnet (netmiko) com **classifier read/write**; SNMP (net-snmp subprocess get/walk).
5. **Endpoints** `exec`/`snmp`/`test` + **`audit_log`** (decorator no `run()`).
6. **Driver Fiberhome (TL1)** no modo controller + endpoints `olts`/`onus` ao vivo.
7. **MCP built-in** em `/mcp`: tools + **catálogo curado** de diagnósticos.
8. **Frontend** (`ui-ux-pro-max`): login, inventário, cadastros, credenciais, console, SNMP, atividade.
9. **Dockerfiles + compose** ponta a ponta; `seed.py` do UNM2000.

### Fase 2 (registrada, fora do MVP)
Escrita/automação com trava dupla + templates · sync engine + busca de ONU por nome · driver de API (RouterOS REST) · aposentadoria da Sync API/Mongo/Open WebUI Tool · tabelas de cache `fiberhome_olt`/`fiberhome_onu`.

---

## 11. Verificação (critérios de aceite)

- `docker compose up` sobe postgres/redis/backend/frontend sem erro; `GET /health` e a tool MCP `health()` retornam `ok`.
- Cadastro de **perfil de credencial**, **grupo**, **controller** e **device** pela UI; persiste no Postgres (conferível via `psql`); segredos aparecem mascarados na API.
- `POST /devices/{id}/snmp/walk` retorna OIDs **resolvidos por nome** (net-snmp + `mibs/`) contra um device de teste.
- `POST /devices/{id}/exec` com `/system resource print` (RouterOS) retorna saída; um comando de **escrita** (`/ip address add ...`) é **recusado** pela allowlist e registrado no `audit_log` como bloqueado.
- `GET /controllers/{id}/olts` lista OLTs ao vivo via TL1 no UNM2000 seedado do `.env`.
- Cliente MCP conecta em `/mcp`, lista devices e roda `snmp_get`.
- Toda execução acima aparece em `GET /audit` / tela de Atividade.

---

## 12. Premissas

- O host Docker roteia para a rede de gerência (TL1 `10.9.9.54:3337`, IPs dos equipamentos). Se houver ACL por IP de origem, backend em `network_mode: host`.
- net-snmp disponível no container (instalado no Dockerfile); `mibs/` é a fonte de resolução simbólica.
- Não há inventário de equipamentos diretos para importar — RouterOS/Cisco/Huawei são cadastrados na UI.

---

## 13. Registro de decisões (entrevista de design)

| # | Tema | Decisão |
|---|------|---------|
| 1 | Posição do Aurora | **Unificado**, absorve o Fiberhome; Sync API/Mongo/Open WebUI Tool aposentados na fase 2 |
| 2 | Modelo Fiberhome | Entidade **`controller`/EMS** separada do `device`; modos **direct**/**controller**; OLT/ONU não são device |
| 3 | Cache/sync | **Ao vivo** + cache curto Redis; sync engine e busca por nome = fase 2 |
| 4 | Escrita | **Read-only no MVP**; classifier no driver; automação = fase 2 |
| 5 | MCP | **Mesmo processo**, `/mcp` via `streamable-http` |
| 6 | SNMP | **net-snmp via subprocess**; `MIBDIRS` na árvore `mibs/`; pysnmp fora |
| 7 | Credenciais | **Perfis reutilizáveis** (`credential`) + padrão herdado do grupo |
| 8 | `api` | **Armazenado**, sem driver no MVP |
| 9 | Bootstrap | Seed **admin + controller UNM2000** do `.env`, cifrado |
| 10 | Frontend | **Admin + console read-only + SNMP + teste**; sem chat embutido |
| 11 | Auditoria | **`audit_log`** + tela de Atividade no MVP |
| 12 | Rede | **Bridge** padrão + nota; `network_mode: host` p/ ACL por origem |
| 13 | Classificação | **Allowlist por device_type (default-deny) + catálogo curado**; escrita livre recusada |
