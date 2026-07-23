#!/usr/bin/env bash
# Instalador idempotente do webhook de deploy — roda NO SERVIDOR de produção.
#
# Faz, num comando só, o que antes era um passo-a-passo manual:
#   - atualiza o checkout para origin/main VIA GIT (nunca por cópia — copiar a
#     pasta 'deploy' para dentro dela mesma é o que gerava o deploy/deploy);
#   - garante o segredo do webhook em /etc/aurora/webhook.env (sem sobrescrever);
#   - instala/atualiza o unit systemd e sobe o serviço.
#
#   sudo deploy/install.sh
#
# Reexecutar é seguro: não duplica nada e NÃO troca o segredo já existente.
#
# Variáveis (com defaults que casam com aurora-webhook.service):
#   DEPLOY_USER          usuário do serviço (default: deploy)
#   SKIP_GIT=1           não mexe no checkout (pula o fetch/reset)
#   AURORA_WEBHOOK_PORT  porta do health check (default: 9000)
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "❌ rode como root: sudo deploy/install.sh" >&2
  exit 1
fi

# Raiz do checkout (este script vive em deploy/).
cd "$(dirname "$0")/.."
REPO_DIR="$PWD"

# Mesma guarda do deploy.sh: se resolvermos para dentro de um 'deploy/' aninhado
# (deploy/deploy/…), abortamos alto em vez de instalar apontando para o lugar errado.
if [ "$(basename "$REPO_DIR")" = "deploy" ] || [ -e deploy/deploy ]; then
  echo "❌ layout de deploy inválido: pasta 'deploy' aninhada detectada em $REPO_DIR." >&2
  echo "   Atualize o servidor com 'git pull' — NÃO copie a pasta 'deploy'." >&2
  exit 1
fi

DEPLOY_USER="${DEPLOY_USER:-deploy}"
WEBHOOK_PORT="${AURORA_WEBHOOK_PORT:-9000}"
ENV_DIR=/etc/aurora
ENV_FILE="$ENV_DIR/webhook.env"
UNIT_SRC="$REPO_DIR/deploy/aurora-webhook.service"
UNIT_DST=/etc/systemd/system/aurora-webhook.service

[ -f "$UNIT_SRC" ] || { echo "❌ $UNIT_SRC não encontrado" >&2; exit 1; }

# --------------------------------------------------------------------------
# 1) Atualiza o checkout via git (traz deploy/ + compose). Nunca por cópia.
# --------------------------------------------------------------------------
if [ "${SKIP_GIT:-0}" != "1" ] && [ -d "$REPO_DIR/.git" ]; then
  echo ">>> atualizando o checkout para origin/main ..."
  git -C "$REPO_DIR" fetch origin --prune
  git -C "$REPO_DIR" reset --hard origin/main
  git -C "$REPO_DIR" --no-pager log --oneline -1
else
  echo ">>> pulando atualização do git (SKIP_GIT=1 ou sem .git)."
fi

# --------------------------------------------------------------------------
# 2) Segredo do webhook — gera só se ainda não existir (não sobrescreve, para
#    não invalidar o Auth Header já configurado no Harbor).
# --------------------------------------------------------------------------
install -d -m 0700 "$ENV_DIR"
if [ ! -f "$ENV_FILE" ]; then
  ( umask 077; printf 'AURORA_WEBHOOK_SECRET=%s\n' "$(openssl rand -hex 32)" > "$ENV_FILE" )
  chmod 600 "$ENV_FILE"
  echo ">>> segredo gerado em $ENV_FILE"
else
  echo ">>> $ENV_FILE já existe — mantido (segredo preservado)."
fi

# --------------------------------------------------------------------------
# 3) Usuário do serviço — apenas avisa (não cria usuário nem mexe em grupos).
# --------------------------------------------------------------------------
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "⚠️  usuário '$DEPLOY_USER' não existe — crie-o ou ajuste User= no unit." >&2
elif ! id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -qx docker; then
  echo "⚠️  '$DEPLOY_USER' não está no grupo 'docker' — o webhook não falará com o Docker." >&2
  echo "    Corrija com: sudo usermod -aG docker $DEPLOY_USER" >&2
fi

# --------------------------------------------------------------------------
# 4) Instala/atualiza o unit. O unit tem os paths /opt/aurora-net-tools
#    embutidos; se o checkout está noutro lugar, reaponta para o REPO_DIR real.
# --------------------------------------------------------------------------
install -m 0644 "$UNIT_SRC" "$UNIT_DST"
if [ "$REPO_DIR" != "/opt/aurora-net-tools" ]; then
  sed -i "s#/opt/aurora-net-tools#$REPO_DIR#g" "$UNIT_DST"
  echo ">>> unit reapontado para $REPO_DIR"
fi
if [ "$DEPLOY_USER" != "deploy" ]; then
  sed -i "s#^User=deploy#User=$DEPLOY_USER#" "$UNIT_DST"
fi

# --------------------------------------------------------------------------
# 5) Permissões dos scripts que o serviço executa.
# --------------------------------------------------------------------------
chmod +x "$REPO_DIR/deploy/deploy.sh" "$REPO_DIR/deploy/webhook.py"

# --------------------------------------------------------------------------
# 6) Sobe/atualiza o serviço.
# --------------------------------------------------------------------------
echo ">>> ativando aurora-webhook ..."
systemctl daemon-reload
systemctl enable --now aurora-webhook
systemctl restart aurora-webhook   # aplica unit/segredo novos numa reexecução
sleep 1
systemctl status aurora-webhook --no-pager --lines=0 || true

echo ">>> health:"
if curl -fsS --max-time 5 "http://localhost:${WEBHOOK_PORT}/health" >/dev/null 2>&1; then
  echo "    ✅ webhook respondendo em :${WEBHOOK_PORT}/health"
else
  echo "    ⚠️  sem resposta em :${WEBHOOK_PORT}/health — veja: journalctl -u aurora-webhook -n 40" >&2
fi

# --------------------------------------------------------------------------
# 7) Próximos passos manuais que não dá para automatizar aqui.
# --------------------------------------------------------------------------
cat <<EOF

------------------------------------------------------------------------------
Concluído. Para fechar o fluxo com o Harbor:

1) Auth Header do webhook (cole na política de notificação do Harbor):
$(grep AURORA_WEBHOOK_SECRET "$ENV_FILE")

2) No projeto 'aurora-nettools' do Harbor, crie um webhook:
     evento    : PUSH_ARTIFACT
     endpoint  : http://<este-servidor>:${WEBHOOK_PORT}/harbor-webhook
     Auth Header: o valor acima

3) Garanta o login no registry (persistente neste host):
     docker login registry.aurora.app.br

Logs do deploy automático:  journalctl -u aurora-webhook -f
------------------------------------------------------------------------------
EOF
