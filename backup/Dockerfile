# Serviço de backup dedicado: pg_dump (client v16, igual ao servidor) + boto3.
# Base postgres:16-alpine garante compatibilidade do pg_dump com o Postgres 16.
FROM postgres:16-alpine

# Python + boto3 num venv (evita o "externally-managed-environment" do Alpine).
# tzdata: para o agendamento em horário fixo (BACKUP_AT) respeitar o fuso TZ.
RUN apk add --no-cache python3 py3-pip tzdata \
    && python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir boto3
ENV PATH="/opt/venv/bin:$PATH"

# Usuário NÃO-root.
RUN adduser -D -u 10001 backup
WORKDIR /app
COPY backup.py .
USER backup

# Sem porta exposta; roda o loop de backup direto.
ENTRYPOINT ["python3", "backup.py"]
