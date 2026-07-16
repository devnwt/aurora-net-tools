# Aurora Nettools — Plano de Sprints (MVP)

Derivado do roadmap §10 do [`SPEC.md`](./SPEC.md). MVP organizado em **5 sprints**. Estimativas em dias ideais de dev (1 dev backend + 1 dev frontend trabalhando em paralelo a partir da Sprint 4).

**Convenção:** ✅ = entregue no scaffold (Sprint 0) · ⬚ = a fazer.

---

> **Status (2026-06-29):** Sprints 0–5 entregues e validadas em Docker (inclusive contra o UNM2000 de produção). MVP funcional completo: `docker compose up` sobe tudo; 50 testes pytest passando. Superfície TL1 de leitura completa (OLTs, PONs, ONUs, localizar ONU e diagnósticos) exposta em REST + MCP e validada ao vivo.
>
> **Geolocalização de device/site + mapa no detalhe (entregue):** `device` e `device_group` ganharam `latitude`/`longitude` (`sa.Float`, migração `c9d0e1f2a3b4`), expostos nos schemas (fluem via `model_dump`, sem tocar handlers). Cadastro de lat/lon no **DeviceForm** (2 campos `type=number step=any`) e no formulário de **Sites** (site/grupo). No **/devices/[id]** a imagem PNG do device desceu para junto de **Interfaces** (substituiu a ilustração SVG sintética `DeviceIllustration`), e o antigo lugar da imagem (topo-direito, área BOARD) agora mostra um **mini-mapa Leaflet** (OSM) com o **marcador = PNG do device** (`DeviceMap.tsx`, `leaflet` 1.9.4). O mapa usa as coordenadas do device e, se ausentes, faz **fallback para as do site/grupo** (legenda "(do site)"). Marcador = **pino padrão do Leaflet** (assets `marker-icon/2x/shadow` importados p/ o Vite resolver as URLs; inlinados como data-URI no bundle). O container do mapa isola seu **stacking context** (`relative z-0`) para os controles do Leaflet (z-index 1000) não vazarem por cima de modais (ex.: Neighbors). **Escolha no mapa quando sem coordenadas:** o mini-mapa vira seletor (clicar posiciona/arrasta o pino → `onPick`); no `/devices/[id]` um botão **Salvar** faz PATCH das coords no device, e no formulário de **Sites** o clique preenche os campos lat/lon. Validado ponta-a-ponta pelo proxy: PATCH/GET de lat/lon persistem em device (7) e grupo (1), build front com leaflet no bundle, migração aplicada (colunas `double precision` em ambas as tabelas).
>
> **Copilot — Fase 1 (entregue):** assistente LLM (usa a config de Settings → LLM por ORG) numa tela `/copilot` com picker de devices por site + modos **Chat / Manual / Automático**. Ao criar a conversa, o **system prompt é montado pelo tipo de device** (RouterOS/Huawei/Cisco) e recebe os **facts anexados** (board, versão, arch, interfaces, serviços — lidos por SSH). Loop de **tool-calling** (`services/copilot.py`): `run_read_command` (leitura via classifier), `get_device_facts`, `list_templates`, `propose_write`; leituras rodam na hora, **escrita vira `CopilotAction`** — em **manual** fica pendente até **Aprovar/Rejeitar**; em **auto** executa sozinha, salvo **denylist de alto risco** (reset-configuration, reboot, `/user remove`, drop em input, disable de interface) que sempre exige aprovação. Tudo via `runner.exec_write` (auditado), escopado por ORG (`owned`), com retry em `TargetBusy` (poller). Modelos `copilot_conversation|message|action|tool` (migração `d4e5f6a7b8c9`), histórico persistido. **MCP HTTP Stream por ORG** já incluso: registra servidor MCP (URL+auth) em *Copilot → MCP Tools*, o backend vira cliente (`streamablehttp_client`), descobre as tools e as expõe ao LLM. Validado ponta-a-ponta com um LLM mock OpenAI-compatible contra o Mikrotik Lab: fluxo de leitura (identity), aprovação de escrita (winbox port, executado), auto-execução, e denylist. Frontend: chat com bolhas, cards de ação [Aprovar/Rejeitar], log de ações resolvidas, gestão de MCP tools.
>
> **Copilot — extensibilidade OpenAPI + Skills (entregue):** o registro `copilot_tool` agora cobre os 3 kinds. **OpenAPI-compatible:** registra a spec (spec_url + base_url opcional + auth); o backend busca a spec, resolve `$ref`, gera uma tool por operação (`oapi_<opId>`, params path/query/header + requestBody JSON) e, na chamada, monta a requisição HTTP real. **Skills:** upload de `.md`/texto (SKILL.md) injetado no system prompt a cada turno (seção `=== Skills ===`), sempre atualizado. `advance` monta as tools de MCP+OpenAPI e o system prompt de conv+skills. Validado ao vivo com mock OpenAPI: descoberta (`oapi_ping`/`oapi_echo`), chamada real (`GET /ping`→200, `POST /echo` com body→eco), e via LLM mock (LLM chamou `oapi_ping`→HTTP 200→resposta) + injeção de skill confirmada (`skill_injected=True`). Resta: streaming SSE.
>
> **Copilot Tools em Settings + robustez de config (entregue):** a gestão de tools (MCP/OpenAPI/Skill, **vários de cada**) saiu do modal do Copilot e virou a aba **Settings → Copilot Tools** (`components/CopilotTools.tsx`), agrupada por tipo; o Copilot passou a linkar para lá. **Bug de persistência de config corrigido:** o `nginx.conf` agora serve `index.html` como `no-cache, must-revalidate` (assets com hash → `immutable`), evitando que o navegador carregue um bundle JS antigo (causa raiz do "LLM não persiste" — o backend/DB/proxy sempre persistiram, verificado). As abas de integração ganharam **init-once** (ref) no preenchimento do formulário, para o GET em andamento não sobrescrever o que o usuário digita. Validado: round-trip PUT/GET pelo proxy `:5173`, headers de cache corretos, e cadastro de 2 MCP + 2 Skills simultâneos.
>
> **Copilot — título, raciocínio e tokens (entregue):** (migração `f6a7b8c9d0e1`) o título da conversa passa a ser **"Nova Conversa Sobre {device}"** (1 device → nome; 2 → "A e B"; 3+ → "N devices"), definido na criação e não sobrescrito pela 1ª mensagem. A janela de chat exibe o **raciocínio (thinking) estilo Claude Code**: o loop captura `reasoning_content`/`reasoning` da resposta (modelos de raciocínio: DeepSeek-R1 etc.) e o front mostra num bloco colapsável `<details>` "Raciocínio". Abaixo da caixa de pergunta, **contador de tokens**: contexto (prompt_tokens do último turno) + total acumulado, lidos do `usage` de cada chamada e persistidos na conversa. Validado com LLM mock: título 1 e 2 devices, `reasoning` capturado/exibido, tokens 1234 (contexto)/1276 (total).
>
> **Login por e-mail + saneamento de senha/e-mail (entregue):** login agora aceita **e-mail** (principal) **ou username** (fallback, p/ contas legadas sem e-mail — nada de lockout); busca case-insensitive `or_(lower(email)==ident, username==ident)`, token continua com `sub=username`. `email` virou campo de 1ª classe: obrigatório+único em `POST /users`, `POST /auth/register` e `POST /admin/orgs` (validação de formato + unicidade case-insensitive; migração `d0e1f2a3b4c5` cria índice único parcial `uq_user_email_lower` em `lower(email) WHERE email IS NOT NULL`). **Diagnóstico da "troca de senha":** a rotina em si estava correta (validado ao vivo: PATCH troca a senha, a antiga é rejeitada e a nova aceita; reset por token idem) — os defeitos reais eram (a) **sem validação de tamanho de senha** em `POST/PATCH /users` (reset/register já exigiam ≥6) e (b) usuários criados pela tela **sem e-mail**, quebrando recuperação de senha e bloqueando login por e-mail. Ambos corrigidos: `_check_password` (≥6) e `_check_email` (formato+unicidade). Front: login rotulado **E-mail** (`type=email`), tela de Users com campo **E-mail (login)** + coluna (marca "— sem e-mail —") + validação, Register e Super Admin (criar ORG) exigindo e-mail válido. Seed do Master usa `ADMIN_EMAIL` (novo no `.env.example`). Validado ao vivo: login por e-mail (inclusive maiúsculas), fallback por username, e-mail duplicado→400, senha curta→400, sem e-mail→422; contas reais intactas.
>
> **Fix — cota de usuários do plano não era aplicada (entregue):** a criação de usuário (`POST /users`) ignorava `plan.max_users`, então um Administrador conseguia cadastrar acima do limite do plano (ex.: plano **Lite** `max_users=2`). Adicionado `_user_limit` (resolve `plan.max_users` da ORG) + checagem em `create_user` espelhando a cota de devices: `count(User onde org)>=limit → 403 "limite de usuários do plano atingido (n/m)"`. Master não é limitado (paridade com devices, `new_org_id=None`). **Devices já estavam corretos** (`_device_limit` em `POST /devices` já bloqueava). Validado ao vivo com ORG de teste no plano Lite: usuário 2/2 ok, 3º → 403; devices 1–5 ok, 6º → 403; ORG de teste removida no fim (sem tocar em dados reais).
>
> **Recuperação de senha + cadastro público (entregue):** rotas públicas `POST /auth/forgot-password` (link de reset via SMTP global; resposta genérica p/ não vazar contas), `POST /auth/reset-password` (token JWT com `purpose=pwreset`, 30 min, sem tabela — `create_scoped_token`/`decode_scoped_token`), `GET /auth/registration-status` e `POST /auth/register`. **Cadastro público** habilitável só pelo Master (`GET/PUT /admin/registration`, flag+plano em `org_settings` global, migração `b8c9d0e1f2a3`): quando ligado, o self-signup **cria nova organização + admin** (`role=admin`, e-mail) e loga na hora. `user.email` reusado (do superadmin). Front: telas públicas `/register` e `/reset-password` + link "Esqueci minha senha"/"Criar conta" no login (casca comum `AuthShell` com o fundo de partículas); toggle "Permitir cadastro público" na aba Organizations do Super Admin. Users page corrigida (usava `is_admin`, ignorado; agora usa `role` com select Operador/Admin/Master) e o Master pode rebaixar o último admin de uma ORG (mantém a proteção do último Master). Validado ao vivo: registro desabilitado→403, habilitar→self-signup cria org+admin+login, reset por token muda a senha e loga, forgot genérico sem vazar — sem tocar no SMTP real do usuário (mail.nwtinternet.com.br).
>
> **Device detail — PPPoE/VLAN, PING e fix MPLS (entregue):** o mapa de interfaces agora mostra **PPPoE** (antes só ether/sfp/bridge/vlan/bond) e agrupa as virtuais por categoria com **cores distintas** (VLAN roxo, PPPoE laranja, Bridge azul, Bond teal, Outras cinza), com cap por grupo (BRAS com muitas sessões). **Falso-positivo de MPLS corrigido:** `/protocols` passou a marcar MPLS ativo por **LDP neighbors** (descarta a entrada default `interface=all` que existe em toda RB) — validado: device sem MPLS → inativo, core com LDP → ativo. **Novo 5º card PING** (grid 4→5): `GET /devices/{id}/ping` faz ping ICMP do servidor até o IP do device (`iputils-ping` na imagem), com latência (min/avg/max) + perda, cor por limiar, auto-refresh 15s. Validado ao vivo: PPPoE do dev7 (pppoe-out1), MPLS dev7=false/dev8=true, ping dev7 3.35ms/dev2 0.57ms. Grafo de vizinhos ganhou zoom (scroll), pan (arrastar fundo), e **persistência de posição** por device (localStorage) + modal `max-w-[95vw]`.
>
> **Device detail — óptica/PoE, protocolos e grafo de vizinhos (entregue):** (1) **Live Traffic** agora segue a interface **clicada** no mapa de Interfaces (estado `liveIface` elevado ao `DeviceDetail`); portas **SFP** destacadas como ópticas (ícone/cor accent + legenda) e, ao selecionar, painel com **TX/RX Power, temp, tensão, vendor, wavelength** (`/mikrotik/optics` = `/interface ethernet monitor once`); portas ether mostram **PoE-out** (status/tensão/corrente/potência) quando disponível (`/mikrotik/poe`). (2) Card **Protocolos — OSPF · MPLS · VPLS** (`/mikrotik/protocols`, exec_many v6/v7-compat) com ativo/inativo + contagens + detalhes (adjacências OSPF, LDP neighbors, túneis VPLS). (3) Botão **Neighbors** → modal (largo) com **grafo force-directed** (`ForceGraph`) do device + vizinhos, aresta rotulada com a **porta local** (`/ip neighbor`). Validado ao vivo no RB de core (RB Ponto Alto, v6.49.7): SFP 2FLEX tx -5.01/rx -6.39 dBm, OSPF/MPLS/VPLS todos ativos (1 adj, 2 LDP, 3 VPLS), 38 vizinhos. Modal ganhou prop `wide`.
>
> **Publicação no Harbor (entregue):** compose com `image: ${REGISTRY:-registry.aurora.app.br/aurora-nettools}/{backend,frontend,proxy}:${IMAGE_TAG:-latest}` → `docker compose build/push` nativo. `push-harbor.sh` (build+push, tag opcional; requer `docker login registry.aurora.app.br`) e `docker-compose.harbor.yml` (deploy pull-based: só puxa as imagens, sem build, com postgres/redis + restart:unless-stopped; expõe só o proxy). Imagens: backend 899 MB (com MIBs), frontend 95 MB (Caddy+dist), proxy 89 MB. Validado: build tagueia com o nome do Harbor, stack sobe usando essas imagens (login/API/SPA via proxy OK, 570 MIBs na imagem), `docker-compose.harbor.yml config` válido.
>
> **Caddy no lugar do nginx + MIBs embutidas (entregue):** o servidor estático do **frontend passou de nginx para Caddy** (`frontend/Dockerfile` estágio caddy:2-alpine servindo `/srv`; `frontend/Caddyfile` com fallback SPA e cache — assets imutáveis, HTML `no-cache`; `nginx.conf` removido). As **MIBs foram embutidas na imagem do backend** (`backend/mibs`, `COPY mibs /app/mibs` em camada própria; removido o volume `./mibs`) — imagem self-contained para o **registry Harbor**; o entrypoint monta `MIBDIRS` recursivo e o net-snmp lê da imagem. Validado: 570 MIBs flat em `/app/mibs`, SNMP carrega da imagem, SPA/API/cache via proxy OK, 51 testes passando. (Imagens prontas p/ tag+push: `backend`, `frontend`, `proxy`.)
>
> **Proxy Caddy (entregue):** `proxy/` com `Caddyfile` + `Dockerfile` (caddy:2-alpine) adaptados ao projeto: ponto de entrada único `:8090` que roteia `/api/*` (strip) → `backend:8000`, `/mcp*` → backend (flush_interval -1, read_timeout 300s), o **SSE do Copilot** (`/api/copilot/.../stream`, matcher `@sse` sem buffer) → backend, e o restante → `frontend:80` (SPA). Serviço `proxy` no compose (`PROXY_PORT`, padrão 8090; o frontend deixou de publicar porta). Validado via Caddy: SPA 200, `/api` login/registration-status, fallback de rota SPA, `/mcp`→backend (307), SSE→backend (404 da conversa). (Neste host o 8090 já estava em uso por outro projeto; subi em 8095 — configurável por `PROXY_PORT`.)
>
> **MinIO/S3 + Copilot Tools → globais no Super Admin (entregue):** seguindo SMTP/LLM, o **MinIO/S3** e as **ferramentas do Copilot** (MCP/OpenAPI/Skill + built-in web/fs) saíram de Settings e viraram **globais, só Master** em Super Admin (`/admin/s3` GET/PUT/test; `/copilot/tools` e `/copilot/builtin` agora `require_master` + `org_id` NULL). O Copilot passou a ler tools/web/fs do global (`_tools_and_system` usa org_id None). Backups: **FTP continua por ORG**, **S3 vem do global**. Settings agora só tem **Home + FTP**. Validado: `/settings/integrations` só `ftp`; org admin (não-master) recebe **403** em `/admin/s3`, `/admin/llm`, `/copilot/tools`, `/copilot/builtin` (GET e PUT); configs reais do usuário intactas no global (SearXNG `search.aurora.app.br`, LLM Qwen). 51 testes passando.
>
> **SMTP/LLM → globais no Super Admin (entregue):** SMTP e LLM saíram de **Settings** (removidas as abas + endpoints `/settings/integrations/{smtp,llm}/test`; `/settings/integrations` agora expõe só `ftp`/`s3`). Ambas viraram **globais**, geridas só pelo Master em **Super Admin → SMTP Global / LLM Global** (`/admin/smtp`, `/admin/llm` GET/PUT/test, require_master). O **Copilot passou a usar o LLM global** para todas as ORGs (`copilot._require_llm` lê org_id NULL); as tools por ORG (web/fs/MCP/OpenAPI/Skill) continuam lidas do org_settings da conversa. Validado: `/settings/integrations` só ftp/s3, endpoints antigos 404, `/admin/llm` retorna a config global, e `_require_llm` resolve o LLM global — sem tocar na config real do usuário.
>
> **Super Admin — área multi-tenant (entregue):** consolidada em **`/admin`** (gated a Master, item único "Super Admin" na sidebar; `/admin/plans` e `/admin/orgs` redirecionam). Hub com abas **Organizations · Plans · SMTP Global**. **SMTP Global** (`/admin/smtp` GET/PUT/test) opera na config do sistema (org_settings org_id NULL) e é a base dos e-mails de acesso. **E-mails via SMTP global** (`services/integrations.send_email`, `user.email` migração `a7b8c9d0e1f2`): **boas-vindas** com credenciais ao criar ORG (checkbox `send_welcome`), e **Reenviar login** por ORG (`POST /admin/orgs/{id}/resend-login`) que gera senha temporária (`secrets.token_urlsafe`), aplica no admin e envia por e-mail. Orgs agora mostram admin username/e-mail; create/edit aceitam `admin_email`. Validado ponta-a-ponta com **MailHog**: teste SMTP, e-mail de boas-vindas na criação, e reenvio de login — a senha extraída do e-mail **fez login com sucesso** (confirma reset real). Nota: para o Master, Settings→SMTP e Super Admin→SMTP Global são a mesma config (org NULL = global).
>
> **Copilot — chat em streaming SSE (entregue):** novo endpoint `POST /copilot/conversations/{id}/stream` (FastAPI `StreamingResponse`, `text/event-stream`) que transmite eventos ao vivo: `delta` (tokens de conteúdo), `reasoning` (tokens de raciocínio), `tool` (ferramenta chamada), `suspended` (ação pendente), `done` (detalhe final autoritativo), `error`. `services/copilot._stream_llm` consome o SSE do LLM (`stream:true` + `stream_options.include_usage`), remonta `tool_calls` fragmentados por índice e acumula usage; `advance_stream` espelha o loop com os mesmos guardrails (leitura/escrita, denylist, aprovação). O gerador roda numa sessão própria (`SessionLocal`) p/ não colidir com o teardown da request. nginx: `proxy_buffering off` no `/api` + header `X-Accel-Buffering: no`. Front (`api.postStream` + leitura de `ReadableStream`): balão ao vivo com cursor piscando, raciocínio streamando e chips de tool; ao `done`, substitui pelo estado persistido. Validado ao vivo com LLM mock streaming: deltas token-a-token (direto e via proxy `:5173`), tokens 666/321, e reassembly de tool_call fragmentado → ação pendente. (Aprovar/rejeitar continua não-streaming, retornando o detalhe completo.)
>
> **Rebrand + tela de login (entregue):** MVP renomeado para **Aurora Prisma NetTools** (título da página, marca da sidebar com `logo.png`, "NetTools" com efeito de fonte em gradiente `primary→cyan→accent`, itálico/bold via `bg-clip-text`). Nova **tela de login**: form **alinhado à esquerda** (painel com blur sobre fundo), **fundo de partículas** (`components/ParticleNetwork.tsx` — port dependency-free/sem jQuery do canvas particle-network com interação de mouse) + world-map/glows animados (CSS em `index.css`, glows `absolute` dentro de container `overflow:hidden` p/ não gerar scrollbar). Validado: build limpo, `logo-*.png` emitido, CSS das partículas no bundle, login 200.
>
> **Copilot — tools embutidas SearXNG + Filesystem (entregue):** duas ferramentas built-in **habilitadas por padrão** por ORG (colunas em `org_settings`, migração `e5f6a7b8c9d0`). **Web Search (SearXNG):** tool `web_search(query)` que consulta `GET {url}/search?format=json`; configurável em *Settings → Copilot Tools* (toggle on por padrão; precisa da URL da instância). **Filesystem:** tools `fs_list/fs_read/fs_write` restritas a uma raiz (padrão `/tmp`), com bloqueio de path-escape (realpath dentro da raiz) e limite de 200 KB — rascunho para o chat. `advance` inclui as built-in conforme os flags da ORG; rodam sem aprovação (não afetam devices). Validado ao vivo: fs write→read→list + escape bloqueado; web_search contra SearXNG mock; e ambas via LLM mock (LLM chamou `web_search` e `fs_write`).
>
> **Reformulação MikroTik Manager (em curso):** front-end adotou o design "MikroTik Manager" (sidebar agrupada OVERVIEW/ACTIONS/SYSTEM, Dashboard com cards + Devices by Site, Devices em cards por site, tela rica de detalhe). Leitura RouterOS ao vivo via SSH (`/devices/{id}/mikrotik/*`): `overview` (system+interfaces+services numa sessão), Firewall (Filter/NAT), DHCP (servers/leases) e rotas — validada ao vivo contra o Mikrotik Lab (10.9.9.123). Concorrência resolvida: `exec_many` (1 sessão SSH) no backend + serialização por device (`rosGet`) no front. Ilustração SVG do device por modelo; chips de Services; mapa de interfaces agrupado.
>
> **Telas entregues:** Dashboard, Devices, **Sites** (CRUD + Add Site, com `location` — migração `c1a2b3d4e5f6`), **Mass Commands** (exec read-only em lote + histórico), **Upgrades** (status de versões read-only, FW pending), **Topology** (nós com CPU/RAM/uptime ao vivo), **Scan Network** (formulário; motor de varredura pendente). Detalhe do device com Firewall/DHCP/Routes/Command.
>
> **Poller + métricas (entregue):** task de background (`services/poller.py`, intervalo configurável) grava `device_status` (snapshot) e `device_sample` (série temporal) — migrações `d2b3c4e5f6a7` e `e3c4d5f6a7b8`. Dashboard/Devices mostram status e métricas reais (Online/Not accessible + CPU/RAM/temp/uptime/board/versão). Detalhe do device tem **gráfico Health** (CPU/Temp/RAM, 6h/24h/7d/30d) auto-atualizado. `rosGet` repete no 409 (blindagem poller↔usuário).
>
> **Health + Live Traffic (entregue):** detalhe do device tem gráfico **Health** (CPU/Temp/RAM, série temporal do poller, 6h/24h/7d/30d) e **Live Traffic** por interface (`/interface monitor-traffic once`, RX/TX ao vivo a cada 3s, leitura silenciosa não-auditada, iface validada contra injeção). Gráfico SVG próprio (`LineChart`, multi-série).
>
> **Topology com links (entregue):** endpoint de vizinhos (`/ip neighbor print`) + grafo posicionado (grade) com arestas entre devices gerenciados (casadas por IP/identity) e nós não-gerenciados (ghosts, toggle Unmanaged). No lab atual há 0 vizinhos (como na referência), mas o grafo monta corretamente.
>
> **Scan Network (entregue):** `POST /scan` varre CIDR/range/IP em 2 fases (TCP na porta SSH → auth SSH só nos abertos), concorrência 48, máx. 512 hosts; retorna os RouterOS achados (IP/identity/board/versão) e o front importa como device (→ tela de edição p/ atribuir credencial). Validado ao vivo: 6 hosts em 1,5s, achou o Mikrotik Lab.
>
> **Templates + Settings (entregue):** **Templates** — CRUD de conjuntos de comandos (nome/descrição/categoria/tipo commands|script/body/enabled, migração `f4d5e6a7b8c9`), com cards + modal. **Settings** — info de sistema/poller + contadores (devices/status/amostras) + "Poll agora" (`POST /settings/poll`). Todos os itens do menu agora são funcionais.
>
> **Gestão IP/DHCP (escrita controlada) + firewall estático (entregue):** Firewall Filter/NAT agora mostram **só regras estáticas** (descartam flag D). Detalhe do device ganhou aba **IP · Addresses** e ações de escrita em **DHCP · Servers/Leases**: add/enable/disable/remove de IP, add/toggle/remove de DHCP server, add-static/make-static/remove de lease. A escrita usa `runner.exec_write` (novo) com comandos **montados no servidor a partir de campos validados** (CIDR/IP/MAC/nome/lease — sem comando livre), auditados como `write`. O exec livre (Command/Mass Commands) segue read-only pela allowlist. Validado ao vivo (add/remove de IP no lab, com permissão de escrita da credencial).
>
> **Users (entregue):** CRUD de contas do app (`/users`, **admin-only** via `require_admin`) — criar/editar (reset de senha + toggle admin)/excluir, com guardas (não excluir a si mesmo nem o último admin). Tela **Users** (visível só a admins) com tabela + modais. Validado: 403 para não-admin, 400 em auto-exclusão/último-admin.
>
> **Backups (entregue):** export de config RouterOS (`/export`, leitura) persistido em `device_backup` (migração `a5b6c7d8e9f0`). Tela **Backups**: cria backup por device, lista histórico, **visualiza** e **baixa** (.rsc) o conteúdo, exclui. Validado ao vivo (export de 6,8 KB do Mikrotik Lab).
>
> **Logs (entregue):** visualização do `/log print` do device (parser colunar `parse_logs`, últimas 500 entradas), com seletor de device, filtro por mensagem/tópico, realce de error/warning e refresh. Validado ao vivo (500 entradas).
>
> **Security (entregue):** painel de hardening RouterOS — `/mikrotik/security` roda serviços/usuários/firewall/system numa sessão e computa findings (severidade ok/warn/fail): serviços inseguros habilitados, SSH em porta padrão, usuário admin padrão, usuários full, proteção da chain input, firmware pendente. Tela com resumo por severidade + lista. Validado ao vivo (2 ok · 3 warn · 1 fail no lab).
>
> **API Keys (entregue):** tokens de acesso programático à API (`ak_…`, só o sha256 é guardado). `get_current_user` aceita `X-API-Key` como auth alternativa (principal admin de serviço, atualiza last_used); CRUD admin-only (`/apikeys`), token exibido uma única vez. Tela **API Keys** (admin) com create/copiar-uma-vez/revogar. Validado ao vivo (auth só por chave → 200; chave inválida → 401; JWT/401 intactos).
>
> **Multi-tenância + Master admin (Fase 1 entregue):** modelos `plan` e `organization` (migração `d8e9f0a1b2c3`); `user.role` (master/admin/operator) + `org_id`; `org_id` em device/device_group/credential. Isolamento por ORG em todas as queries (devices/sites/credenciais/usuários + acesso ao vivo RouterOS + backups) via helpers `scope/owned/new_org_id`; Master vê tudo. **Cota de devices por plano** aplicada na criação. API Master `/admin` (planos CRUD + orgs CRUD que já cria o Administrador da ORG; cascade delete). Frontend: papel em `/auth/me`, grupo ADMIN (só Master) com **Plans** e **Organizations**. Validado ao vivo: isolamento (admin de org não vê devices do master), cota 403 (2/2), cascade. **Fase 2 (entregue — racks + grafo):** modelos `rack` e `rack_link` + `device.rack_id` (migração `e9f0a1b2c3d4`), escopados por ORG. Estrutura **Site → Rack → Device** e **ligações rack↔rack por interface** (iface_a/iface_b). Endpoint `/graph` (nós site/rack/device + arestas de contenção e links). Tela **Racks & Map**: grafo **force-directed próprio** (sem dependência, arrastar nós, estilo neo4j) + gestão (criar rack no site, atribuir device a rack, criar/excluir links). Validado ao vivo (grafo com site→racks→device + link ether5↔ether1). **Fase 3 (entregue — grupos de usuários):** modelo `user_group` (org-escopado, aninhável via `parent_id`) + `user.usergroup_id` (migração `a1b2c3d4e5f6`); router `/user-groups` CRUD (admin/master, escopado, valida pai na ORG, impede auto-pai). `/graph` estende com nós **usergroup/user** e arestas de aninhamento (pai→filho) e pertencimento (grupo→usuário), só para admin/master. Tela **Racks & Map**: cartões "Grupos de usuários" (criar com pai opcional, excluir) e "Usuários → Grupo" (atribuir via select), gated a admin; legenda/cores roxo (grupo) e ciano (usuário). Validado ao vivo: NOC⊃NOC-N1, admin→NOC-N1, `/graph` com arestas `ug-1→ug-2` e `ug-2→user-1`; no-auth 401; cascade (delete grupo → filhos/membros SET NULL). 51 testes passando.
>
> **Isolamento multi-tenant completo:** `org_id` também em controller/template/webhook/api_key/audit_log (migração `f0a1b2c3d4e5`); todas as queries escopadas. A auditoria grava o `org_id` do device; o dispatch de webhooks respeita a ORG (org + globais do master); a auth por API key herda a ORG/papel da chave. Validado ao vivo: um Administrador de ORG vê 0 recursos do Master (controllers/templates/webhooks/apikeys/audit) e só os seus. **MCP por ORG (entregue):** middleware ASGI (`mcp/auth.py`) autentica a sessão MCP por `X-API-Key` e fixa o principal (ORG/papel) num ContextVar (`mcp/context.py`); as tools escopam por ORG (`listar_*`/`buscar_device`/`_get_device`/`_fh_call`). Chave sem ORG = Master (vê tudo); chave de ORG = só a ORG; sem chave = nada. Validado com **cliente MCP real**: master `['Mikrotik Lab','acme-rb']`, org `['acme-rb']`, sem chave `[]`. **Isolamento multi-tenant agora é completo, inclusive na superfície de IA.**
>
> **Device · PNG oficial por board (entregue):** os PNGs oficiais do MikroTik ficam em `frontend/src/mikrotik_png` (nomeados pelo board); Vite os importa via `import.meta.glob` (URLs com hash; pequenos são inlined como data-URI). `lib/deviceImage.ts` mapeia o `board` do RouterOS → arquivo via normalização em duas variantes (`+`→`plus` e `+`→"") + redução de nomes duplicados, casando por igualdade → prefixo (sem match cai no desenho sintético). Layout de `/devices/{id}` reorganizado: a área do BOARD mostra a **imagem real do device** (`DeviceImage`, com fallback), e o **desenho de portas** (`DeviceIllustration`) foi movido para **ao lado de Interfaces**. (Migrado de SVG para PNG a pedido; o pacote SVG antigo foi removido.)
>
> **Device · Services + Integrações (entregue):** nova aba **Services** no device RouterOS (`/devices/{id}`, junto a IP/Filter/NAT) — lista `/ip service` (só estáticos, filtra flag D) com porta, *Available From* e certificado; ações **Enable/Disable** e **Edit** (porta + redes permitidas) via comando montado no servidor por nome do serviço (`/ip service set <name> …`, evita casar entradas dinâmicas homônimas), auditado como write. Endpoints `GET /devices/{id}/mikrotik/ip/services` + `.../set` + `.../toggle`. **Settings em abas** (Home · SMTP · FTP · LLM): o conteúdo antigo (sistema & poller) virou a aba **Home**; três integrações **por ORG** persistidas em `org_settings` (migração `b2c3d4e5f6a7`, org_id único; master = global) com segredos cifrados via Fernet e nunca retornados (apenas flag `*_set`). **SMTP** (host/porta/user/senha/from/STARTTLS + envio de e-mail de teste), **FTP/FTPS** (host/porta/user/senha/dir + teste de conexão), **MinIO/S3** (endpoint/region/bucket/access+secret/prefixo/TLS via boto3 path-style s3v4 + teste `head_bucket`), **LLM OpenAI-compatible** (base URL/modelo/api-key + teste via `POST /chat/completions`). **Backup com envio (entregue):** ao criar backup, checkboxes **Enviar por FTP** e **Enviar por MinIO/S3** (migração `c3d4e5f6a7b8`); o backend faz upload best-effort e devolve `uploads:{ftp,s3}` com ok/detalhe por destino (nome `{device}-{ts}.rsc`). Validado com MinIO real: config→teste `head_bucket` ok→backup enviado a `s3://backups/routeros/…` (confirmado via `mc ls`); FTP não configurado → falha graciosa. GET aberto (segredos mascarados); PUT/testes só admin (`require_admin`); merge parcial preserva segredos quando o campo é omitido. Validado ao vivo: defaults, PUT com/sem segredo, cifra no banco (`gAAAA…`), teste LLM alcança a API (401 com chave falsa), set/clear de `address` num serviço real com reversão; 51 testes passando.
>
> **Webhooks (entregue):** notificações HTTP em eventos de status (`device.online`/`device.offline`). Modelo `webhook` (migração `c7d8e9f0a1b2`), CRUD admin-only + **Test**, entrega best-effort (`services/webhooks.py`, timeout 8s, HMAC-SHA256 opcional no header `X-Aurora-Signature`). O **poller** detecta transição de status (compara com o snapshot anterior) e dispara o evento. Validado: entrega HTTP alcança o servidor, URL inalcançável → 502. **Backlog do design MikroTik Manager concluído** (License descartada).

## Sprint 0 — Fundação (✅ concluída)

Scaffold do backend + infra. **Entregue.**

- ✅ Estrutura `backend/app` (core: config, db async, crypto Fernet, security JWT, redis).
- ✅ Modelos SQLAlchemy: `Controller`, `Device`, `DeviceGroup`, `Credential`, `User`, `AuditLog` (§3).
- ✅ Alembic configurado (`env.py` async, autogenerate).
- ✅ FastAPI com `/health` (DB+Redis), `/auth/login`, `/auth/me`.
- ✅ `seed.py` (admin + controller UNM2000 do `.env`).
- ✅ `docker-compose` (postgres, redis, backend, frontend), Dockerfile + entrypoint (MIBDIRS, migração, seed), `.env.example`, README.
- ✅ Frontend placeholder (nginx).

**DoD:** `docker compose up` sobe tudo; `/health` retorna `ok`. *(Pendência operacional: gerar a 1ª migração `alembic revision --autogenerate` — feito na Sprint 1.)*

---

## Sprint 1 — Inventário e credenciais (CRUD)  · ~4–5 dias

Núcleo de cadastro. Sem acesso à rede ainda.

| # | Tarefa | Est. |
|---|--------|------|
| 1.1 | Gerar migração inicial (`initial schema`) e validar `upgrade head` | 0.5 |
| 1.2 | Schemas Pydantic (entrada/saída) com **mascaramento de segredos** (`secret -> ********`) | 0.5 |
| 1.3 | CRUD `/credentials` (cifra `secret` na escrita via `crypto.encrypt`) | 1 |
| 1.4 | CRUD `/groups` (com credenciais-padrão) | 0.5 |
| 1.5 | CRUD `/controllers` | 0.5 |
| 1.6 | CRUD `/devices` (FKs de credencial + flags por protocolo) | 1 |
| 1.7 | Serviço de **resolução de credencial** (device → grupo → erro) | 0.5 |
| 1.8 | Testes de CRUD + mascaramento (pytest + httpx) | 0.5 |

**Dependências:** Sprint 0. **DoD:** criar credencial/grupo/controller/device via API; segredos nunca vazam em texto; resolução device→grupo coberta por teste.

---

## Sprint 2 — Drivers read-only (SSH/Telnet/SNMP)  · ~5–6 dias

O coração do produto: alcançar equipamentos, só leitura.

| # | Tarefa | Est. |
|---|--------|------|
| 2.1 | `drivers/base.py`: protocolo `Driver` + `classify(command)->read/write` | 0.5 |
| 2.2 | **Classifier** por device_type (allowlist default-deny, §13) + mapa de verbos de escrita p/ fase 2 | 1 |
| 2.3 | Driver SSH/Telnet (netmiko; map routeros/cisco/huawei) + fallback paramiko | 1.5 |
| 2.4 | Driver SNMP (wrapper net-snmp `snmpget`/`snmpbulkwalk`, parse `{oid,type,value}`, MIBDIRS) | 1.5 |
| 2.5 | **Lock de conexão no Redis** por device (evita sessões concorrentes) | 0.5 |
| 2.6 | `audit_log` via decorator no `run()` (actor, classificação, duração, resumo) | 0.5 |
| 2.7 | Endpoints `/devices/{id}/exec`, `/snmp/get`, `/snmp/walk`, `/test`, `/audit` | 1 |

**Dependências:** Sprint 1. **DoD:** `exec` de um `print`/`show` retorna saída; comando de escrita é **recusado** e auditado; `snmp/walk` resolve OID por nome; toda execução aparece em `/audit`.

---

## Sprint 3 — Fiberhome (TL1) + catálogo + MCP  · ~5–6 dias

Absorção do Fiberhome ao vivo e a superfície de IA.

| # | Tarefa | Est. |
|---|--------|------|
| 3.1 | Portar `fiberhome_tl1.py` → `drivers/fiberhome.py` (modo controller, só leitura) | 1.5 |
| 3.2 ✅ | Endpoints `/controllers/{id}/olts`, `/olts/{oltid}/pons`, `/olts/{oltid}/onus`, `/test` (TL1 ao vivo); testes com socket TL1 falso | 1 |
| 3.3 | Cache TTL curto no Redis p/ consultas pesadas (lista OLT/ONU) | 0.5 |
| 3.4 | **Catálogo curado** de diagnósticos por device_type (`app/catalog/`) + endpoints | 1 |
| 3.5 | Montar **FastMCP** em `/mcp`; tools: listar/buscar device, exec, snmp get/walk, health | 1 |
| 3.6 ✅ | Tools MCP do catálogo + Fiberhome (todas as leituras TL1: olts/info/boards/shelves/pons/onus/estados/não-registradas/alarmes + localizar ONU e diagnósticos state/optical/info/lan/config/wan/macs/laninfo/portvlan/service) | 1 |

**Dependências:** Sprint 2. **DoD:** cliente MCP conecta em `/mcp`, lista devices e roda `snmp_get`; `GET /controllers/{id}/olts` lista OLTs ao vivo do UNM2000 seedado.

---

## Sprint 4 — Frontend (painel)  · ~6–7 dias  *(paralelizável a partir da Sprint 2)*

React + Vite + shadcn/ui com a skill **`ui-ux-pro-max`**.

| # | Tarefa | Est. |
|---|--------|------|
| 4.1 | Bootstrap Vite + Tailwind + shadcn + cliente API (axios/fetch + JWT) | 1 |
| 4.2 | Tela de **Login** + guarda de rota + store do token | 0.5 |
| 4.3 | **Inventário** (tabela densa controllers+devices, filtros grupo/tipo/status) | 1.5 |
| 4.4 | Form de cadastro/edição de device (abas SSH/Telnet/SNMP/API + seleção de credencial) | 1.5 |
| 4.5 | Telas **Credenciais** e **Grupos** | 1 |
| 4.6 | **Console read-only** (exec + botões do catálogo) e painel **SNMP** get/walk | 1 |
| 4.7 | Tela **Atividade** (audit_log) + tela de **teste de conectividade** | 0.5 |
| 4.8 | Dockerfile real (estágio node build → nginx) substituindo o placeholder | 0.5 |

**Dependências:** APIs das Sprints 1–3 (mock até lá). **DoD:** operador cadastra device, roda diagnóstico read-only e vê auditoria, tudo pelo navegador.

---

## Sprint 5 — Hardening e entrega  · ~3–4 dias

| # | Tarefa | Est. |
|---|--------|------|
| 5.1 | Tratamento de erros consistente (timeouts SSH/SNMP/TL1, mensagens claras) | 1 |
| 5.2 | Paginação/ordenção nas listagens; índices no Postgres | 0.5 |
| 5.3 | Testes de integração ponta a ponta (compose) cobrindo os critérios §11 | 1 |
| 5.4 | Logs estruturados + rotação; revisão de segurança (segredos, JWT, CORS) | 0.5 |
| 5.5 | Documentação de operação (runbook: seed, rede/ACL, backup do Postgres) | 0.5 |

**DoD:** todos os critérios de aceite do SPEC §11 verdes em ambiente de compose.

---

## Visão de dependências

```
Sprint 0 ✅
   └─> Sprint 1 (CRUD)
          └─> Sprint 2 (drivers read-only)
                 ├─> Sprint 3 (TL1 + catálogo + MCP)
                 └─> Sprint 4 (frontend) ── consome 1–3
                            └─> Sprint 5 (hardening)
```

Frontend (Sprint 4) pode começar com mocks logo após a Sprint 1 e ir plugando as APIs conforme 2–3 entregam.

## Fora do MVP (backlog fase 2)

Escrita/automação com trava dupla + templates · sync engine + busca de ONU por nome · driver de API (RouterOS REST) · tabelas de cache `fiberhome_olt`/`fiberhome_onu` · aposentadoria da Sync API/Mongo/Open WebUI Tool legados.
