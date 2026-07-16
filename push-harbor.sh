#!/usr/bin/env bash
# Build + push das imagens para o Harbor (registry.aurora.app.br/aurora-nettools).
#
# Uso:   ./push-harbor.sh [tag]        (tag padrão: latest)
# Antes: docker login registry.aurora.app.br
set -euo pipefail

export REGISTRY="${REGISTRY:-registry.aurora.app.br/aurora-nettools}"
export IMAGE_TAG="${1:-latest}"

echo ">>> build (backend+MIBs, frontend+Caddy, proxy) — tag: ${IMAGE_TAG}"
docker compose build backend frontend proxy

echo ">>> push para ${REGISTRY}"
docker compose push backend frontend proxy

echo ">>> publicado:"
echo "    ${REGISTRY}/backend:${IMAGE_TAG}"
echo "    ${REGISTRY}/frontend:${IMAGE_TAG}"
echo "    ${REGISTRY}/proxy:${IMAGE_TAG}"
echo ">>> no servidor: docker compose -f docker-compose.harbor.yml pull && ... up -d"
