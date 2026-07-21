#!/usr/bin/env bash
# Deploy de produção — consome as imagens que o workflow "Build & Push" já
# publicou no Harbor. NÃO builda nada e não fala com o GitHub.
#
# Roda NO SERVIDOR de produção, num diretório que tenha `docker-compose.harbor.yml`
# e o `.env` de produção ao lado.
#
#   ./deploy/deploy.sh a1b2c3d      # implanta a tag a1b2c3d
#   ./deploy/deploy.sh 9f8e7d6      # ROLLBACK = implantar uma tag anterior
#
# As tags são imutáveis (SHA curto do commit), então voltar versão é só
# implantar a tag antiga — não existe estado especial de "rollback".
#
# Se a stack nova não subir ou não passar no smoke test, o script reverte
# sozinho para a versão que estava rodando antes.
#
# Variáveis: COMPOSE_FILE, REGISTRY (têm padrões sensatos abaixo).
set -euo pipefail

TAG="${1:-}"
if [ -z "$TAG" ]; then
  cat >&2 <<'EOF'
uso: deploy.sh <tag>

  <tag>  SHA curto publicado pelo workflow "Build & Push" (ex.: a1b2c3d).
         O resumo daquele job mostra a tag exata.

Rollback: implante uma tag anterior — elas são imutáveis.
EOF
  exit 2
fi

# 'latest' é um alias móvel: implantá-la torna impossível saber depois QUAL
# versão está no ar e, pior, apaga o alvo do rollback automático — o script
# descobre a versão anterior lendo a tag do container em execução.
if [ "$TAG" = "latest" ]; then
  echo "❌ recuse 'latest' em produção: ela não identifica versão e inviabiliza o rollback." >&2
  echo "   Use o SHA curto (ex.: a1b2c3d)." >&2
  exit 2
fi

# Raiz do repo/diretório de deploy (o script vive em deploy/).
cd "$(dirname "$0")/.."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.harbor.yml}"
REGISTRY="${REGISTRY:-registry.aurora.app.br/aurora-nettools}"
COMPOSE=(docker compose -f "$COMPOSE_FILE")

[ -f "$COMPOSE_FILE" ] || { echo "❌ $COMPOSE_FILE não encontrado em $PWD" >&2; exit 1; }
[ -f .env ]            || { echo "❌ .env não encontrado em $PWD (o backend depende dele)" >&2; exit 1; }

# --------------------------------------------------------------------------
# Versão em execução — alvo do rollback.
#
# Lida do container, não de um arquivo de estado: um arquivo mente se alguém
# subir a stack na mão. Retorna vazio quando a versão não é identificável
# (stack parada, ou rodando ':latest'), e aí não há para onde reverter.
# --------------------------------------------------------------------------
current_tag() {
  local cid tag
  cid="$("${COMPOSE[@]}" ps -q backend 2>/dev/null | head -1)" || return 0
  [ -n "$cid" ] || return 0
  tag="$(docker inspect --format '{{.Config.Image}}' "$cid" 2>/dev/null)" || return 0
  tag="${tag##*:}"
  case "$tag" in ''|latest|*/*) return 0 ;; esac
  printf '%s' "$tag"
}

# --------------------------------------------------------------------------
# Porta publicada pelo proxy, perguntada ao Docker e não lida do .env: é a
# única fonte que prova que o bind REALMENTE aconteceu. Já houve caso do proxy
# ficar "Up" e o Caddy logar "server running" sem publicar porta nenhuma
# (outro stack ocupava a 8090) — pelo .env o teste checaria uma porta que não
# é nossa e passaria verde.
# --------------------------------------------------------------------------
published_port() {
  local bind port
  bind="$("${COMPOSE[@]}" port proxy 8090 2>/dev/null | head -1)" || true
  port="${bind##*:}"
  # Sem bind o compose NÃO devolve vazio: imprime "invalid IP:0". Por isso a
  # checagem é a porta ser inteiro positivo, não a string ser vazia.
  case "$port" in ''|0|*[!0-9]*) return 1 ;; esac
  printf '%s' "$port"
}

smoke() {
  local port body i
  if ! port="$(published_port)"; then
    echo "❌ o serviço 'proxy' não publicou a porta 8090 no host." >&2
    echo "   Causa usual: colisão de porta — confira PROXY_PORT no .env." >&2
    "${COMPOSE[@]}" ps >&2
    ss -ltnp 2>/dev/null | grep -E ':(8090|8091)' >&2 || true
    return 1
  fi
  echo ">>> proxy publicado na porta $port — validando /api/health ..."

  for i in $(seq 1 30); do
    body="$(curl -fsS --max-time 5 "http://localhost:$port/api/health" 2>/dev/null)" \
      || { sleep 3; continue; }
    body="$(printf '%s' "$body" | tr -d ' ')"

    # HTTP 200 não basta: o /health reporta o estado de cada dependência e uma
    # stack com o banco fora responde 200 com "database":false.
    case "$body" in
      *'"status":"ok"'*) ;;
      *) echo "    health degradado: $body"; sleep 3; continue ;;
    esac
    case "$body" in
      *false*) echo "    dependência fora: $body"; sleep 3; continue ;;
    esac
    echo "✅ backend saudável (tentativa $i): $body"

    # A SPA sai do mesmo proxy; sem checar, um frontend quebrado passaria.
    if ! curl -fsS --max-time 5 -o /dev/null "http://localhost:$port/"; then
      echo "❌ backend ok, mas a SPA não respondeu em /" >&2
      "${COMPOSE[@]}" logs frontend proxy --tail=30 >&2
      return 1
    fi
    echo "✅ SPA respondendo"
    return 0
  done

  echo "❌ aplicação não estabilizou em ~90s — estado e logs:" >&2
  "${COMPOSE[@]}" ps >&2
  "${COMPOSE[@]}" logs --tail=40 >&2
  return 1
}

# --------------------------------------------------------------------------
PREV="$(current_tag)"
echo ">>> em produção agora: ${PREV:-não identificável (stack parada ou ':latest')}"
echo ">>> implantando: $TAG"

export IMAGE_TAG="$TAG"

# Puxar ANTES de mexer na stack: se a tag não existe no Harbor ou falta login,
# o deploy aborta sem ter tocado em produção.
if ! "${COMPOSE[@]}" pull; then
  echo "❌ não consegui puxar as imagens da tag '$TAG'." >&2
  echo "   Confira se o workflow 'Build & Push' publicou essa tag e se há" >&2
  echo "   'docker login ${REGISTRY%%/*}' válido neste servidor." >&2
  exit 1
fi

if "${COMPOSE[@]}" up -d --remove-orphans && smoke; then
  echo "✅ deploy de '$TAG' validado"
  "${COMPOSE[@]}" ps
  docker image prune -f >/dev/null 2>&1 || true
  exit 0
fi

# --------------------------------------------------------------------------
# Rollback
# --------------------------------------------------------------------------
echo "" >&2
echo "❌ o deploy de '$TAG' falhou." >&2

if [ -z "$PREV" ]; then
  echo "❌ sem versão anterior identificável para reverter automaticamente." >&2
  echo "   Reverta na mão: IMAGE_TAG=<tag-boa> docker compose -f $COMPOSE_FILE up -d" >&2
  "${COMPOSE[@]}" ps >&2
  exit 1
fi

echo "⏪ revertendo para '$PREV' ..." >&2
export IMAGE_TAG="$PREV"
# As imagens antigas costumam continuar no host (o prune só tira dangling),
# mas se o disco foi limpo é preciso buscá-las de novo.
docker image inspect "$REGISTRY/backend:$PREV" >/dev/null 2>&1 || "${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d --remove-orphans

# Reverter sem confirmar deixaria você sem a informação que mais importa
# neste momento: produção voltou ou não?
if smoke; then
  echo "✅ rollback concluído — produção respondendo em '$PREV'" >&2
  echo "   O deploy de '$TAG' foi descartado; investigue antes de tentar de novo." >&2
  exit 1
fi

echo "🔥 ROLLBACK FALHOU — produção está fora do ar. Intervenção manual necessária." >&2
"${COMPOSE[@]}" ps >&2
"${COMPOSE[@]}" logs --tail=40 >&2
exit 1
