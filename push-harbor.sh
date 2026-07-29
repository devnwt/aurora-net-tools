#!/usr/bin/env bash
# Build + push das imagens para o Harbor (registry.aurora.app.br/aurora-nettools).
#
# Uso:   ./push-harbor.sh [tag]                  (tag padrão: latest)
#        PUSH_LATEST=1 ./push-harbor.sh a1b2c3d  (publica a tag E move 'latest')
#
# Antes: docker login registry.aurora.app.br
#
# NÃO faz deploy — só publica. Quem implanta em produção é deploy/deploy.sh,
# executado no servidor.
set -euo pipefail

# Roda a partir da raiz do repo mesmo se chamado de outro diretório: o compose
# de build referencia ./backend, ./frontend e ./proxy por caminho relativo.
cd "$(dirname "$0")"

export REGISTRY="${REGISTRY:-registry.aurora.app.br/aurora-nettools}"
export IMAGE_TAG="${1:-latest}"

# Compose de BUILD versionado. O docker-compose.yml de dev está fora do git e
# exige .env/portas — num runner limpo (ubuntu-latest) ele nem existe.
COMPOSE=(docker compose -f docker-compose.build.yml)

# A lista de imagens vem do próprio compose de build, em vez de repetida à mão.
# Antes era fixa ('backend frontend proxy'): quando o serviço 'backup' entrou no
# compose de deploy, esta linha não acompanhou e a imagem nunca foi publicada.
mapfile -t IMAGES < <("${COMPOSE[@]}" config --services | sort)

# Guarda contra a mesma divergência pelo outro lado: tudo que o deploy espera
# puxar do registry precisa ter build aqui. Falhar no CI é barato; a alternativa
# é o `deploy.sh` abortar no `pull` por uma imagem que não existe — longe daqui
# e com produção esperando.
MISSING=""
for want in $(sed -n 's#.*}/\([a-z0-9_-]*\):\${IMAGE_TAG.*#\1#p' docker-compose.harbor.yml | sort -u); do
  printf '%s\n' "${IMAGES[@]}" | grep -qx "$want" || MISSING="$MISSING $want"
done
if [ -n "$MISSING" ]; then
  echo "❌ docker-compose.harbor.yml espera imagens que este build não produz:${MISSING}" >&2
  echo "   Declare o serviço em docker-compose.build.yml com 'build: ./<dir>'." >&2
  exit 1
fi

echo ">>> build (${IMAGES[*]}) — tag: ${IMAGE_TAG}"
"${COMPOSE[@]}" build "${IMAGES[@]}"

echo ">>> push para ${REGISTRY}"
"${COMPOSE[@]}" push "${IMAGES[@]}"

# 'latest' é um alias móvel de conveniência (dev, pull rápido). Produção nunca
# deve ser implantada por ele — é justamente por não identificar versão que o
# rollback do deploy.sh o recusa como alvo.
if [ "${PUSH_LATEST:-0}" = "1" ] && [ "${IMAGE_TAG}" != "latest" ]; then
  echo ">>> movendo a tag 'latest' para ${IMAGE_TAG}"
  for img in "${IMAGES[@]}"; do
    docker tag  "${REGISTRY}/${img}:${IMAGE_TAG}" "${REGISTRY}/${img}:latest"
    docker push "${REGISTRY}/${img}:latest"
  done
fi

echo ">>> publicado:"
for img in "${IMAGES[@]}"; do
  echo "    ${REGISTRY}/${img}:${IMAGE_TAG}"
done
echo ">>> no servidor: ./deploy/deploy.sh ${IMAGE_TAG}"
