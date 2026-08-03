---
name: aurora-deploy
description: >-
  Deploy e CI/CD do Aurora NetTools (Harbor, webhook, deploy.sh). Use when
  debugging production deploy, webhook, Harbor tags, compose harbor, IMAGE_TAG,
  ProtectHome, CSP proxy, or why production did not update after a merge.
---

# Aurora Deploy — referência rápida

## Cadeia (ordem real)

```
merge em main
  → GitHub Actions (ubuntu-latest) builda + push Harbor (tag = SHA curto)
  → Harbor PUSH_ARTIFACT
  → aurora-webhook (systemd na prod) → deploy/deploy.sh <tag>
```

- Actions **não** implanta. Runner self-hosted antigo **não** faz deploy.
- Só push/merge em **`main`** publica imagens. `develop` sozinho não atualiza produção.

## Arquivos-chave

| O quê | Onde |
|-------|------|
| Build/push | `.github/workflows/build-push.yml`, `push-harbor.sh`, `docker-compose.build.yml` |
| Deploy prod | `deploy/deploy.sh`, `docker-compose.harbor.yml` |
| Webhook | `deploy/webhook.py`, `deploy/aurora-webhook.service`, `deploy/install.sh` |
| Segredo/porta | `/etc/aurora/webhook.env` (`AURORA_WEBHOOK_SECRET`, `AURORA_WEBHOOK_PORT`) |
| App prod | `/opt/Aurora-Nettools` + `.env` (ignorado pelo git) |

Tag = primeiros 7 chars do SHA do commit em `main`. **Nunca** implantar `latest` (`deploy.sh` recusa).

## Deploy manual (quando o automático falha)

```bash
cd /opt/Aurora-Nettools
./deploy/deploy.sh <sha7>    # ex.: f812e06
docker ps --format '{{.Names}}\t{{.Image}}' | grep aurora
```

Smoke: porta do proxy + `GET /api/health` (status ok, sem `"false"`) + SPA `/`.

## Checklist se produção não atualizou

1. Commit está em **`origin/main`**? (`git fetch` + `git log origin/main -1`)
2. Imagens no Harbor? `docker manifest inspect registry.aurora.app.br/aurora-nettools/backend:<tag>`
3. Webhook ativo? `systemctl is-active aurora-webhook` + `journalctl -u aurora-webhook -n 40`
4. Harbor aponta para a porta certa? (prod: **9100** — MinIO ocupa 9000–9001)
5. Usuário `deploy` tem login no registry e grupo `docker`?
6. Compose da prod atualizado? (compose velho ≠ `main` = features/volumes faltando)

## Armadilhas já vistas (e o remendo)

| Sintoma | Causa | Remendo |
|---------|--------|---------|
| Webhook desiste: imagens “não apareceram” em 900s | `ProtectHome=yes` esconde `~/.docker/config.json` | `ProtectHome=read-only` no unit |
| Porta 9000/9001 “livre” mas curl vira MinIO | MinIO publica range 9000–9001 | Usar **9100** (ou outra fora do range) |
| Compose exige `backup` e `pull` falha | Imagem não estava no `docker-compose.build.yml` / lista fixa no push | Listas derivadas do compose; guarda no `push-harbor.sh` |
| Fontes/imagens “sumiram” (DevTools vermelho) | CSP do proxy bloqueava Google Fonts / Unsplash / OSM | CSP alargada em `proxy/Caddyfile` |
| Após `compose down -v` voltou versão antiga | `-v` apaga `pgdata` + `.env` com `IMAGE_TAG=latest` + `up` sem SHA | Sempre `./deploy/deploy.sh <sha>`; **não** usar `latest` |
| Observabilidade vazia / amnésia | Sem bind `./log:/app/log` no compose da prod | Compose do `main` + pasta `log/` |
| Checkout/plano pago ou WhatsApp “sumiram” | Faltam `HUB_AURORA_TOKEN` / `SUPPORT_WHATSAPP_URL` no `.env` | Defaults desligam a feature |

## Regras de ouro

- Produção **só puxa** imagens; não builda.
- Listas de imagens **não** ficam fixas em três lugares — saem do compose de build/deploy.
- Pasta `deploy/` chega por **git**, não por `cp -r` (evita `deploy/deploy` aninhado).
- `down -v` em prod = apaga banco. Reset de dados ≠ trocar tag de imagem.
- Webhook roda como usuário **`deploy`**, não root — login Harbor é o dele.

## Comandos úteis

```bash
# webhook
systemctl show aurora-webhook -p ProtectHome
curl -s http://localhost:9100/health   # esperado: {"detail": "ok"}
journalctl -u aurora-webhook -f

# provar credencial sob o mesmo sandbox do serviço
sudo systemd-run --quiet --wait --collect --uid=deploy --gid=docker \
  -p ProtectHome=read-only -p ProtectSystem=strict -p PrivateTmp=yes \
  "$(command -v docker)" manifest inspect registry.aurora.app.br/aurora-nettools/backend:<tag>
```

## Observabilidade (contexto)

- Aba `/logs` → Observabilidade = Master; lê `events.jsonl` (**WARNING+**).
- Erros 5xx / lockout de login: sim. Login com sucesso: **não** logado hoje.
- Health app: `/api/health`. Métricas: `/api/metrics` (sem scrape padrão).
