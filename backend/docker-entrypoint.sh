#!/usr/bin/env bash
set -e

# Monta MIBDIRS com a raiz + todos os subdiretórios de vendor (net-snmp não recursa).
if [ -d "/app/mibs" ]; then
    MIBDIRS=$(find /app/mibs -type d | paste -sd ':' -)
    export MIBDIRS
fi

# Aguarda o Postgres
echo ">>> aguardando Postgres em ${POSTGRES_HOST}:${POSTGRES_PORT}..."
until python -c "import socket,os,sys; s=socket.socket(); s.settimeout(2); s.connect((os.environ['POSTGRES_HOST'], int(os.environ['POSTGRES_PORT']))); s.close()" 2>/dev/null; do
    sleep 1
done

# Migrações + seed
echo ">>> rodando migrações Alembic..."
alembic upgrade head || echo ">>> (nenhuma migração ainda — gere com 'alembic revision --autogenerate')"

echo ">>> rodando seed..."
python -m app.seed || echo ">>> seed pulado"

exec "$@"
