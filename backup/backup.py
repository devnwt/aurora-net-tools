#!/usr/bin/env python3
"""Serviço de backup DEDICADO do Postgres do Aurora Prisma NetTools.

Roda como um contêiner próprio, isolado do app:
- NÃO importa nada de `backend/app`. Lê apenas variáveis de ambiente próprias.
- Usa `pg_dump` (conectando ao serviço Postgres) + `boto3` para enviar ao S3.
- Config de S3 e de SMTP é PRÓPRIA (`BACKUP_S3_*` / `BACKUP_SMTP_*`) — não depende
  do banco/`org_settings`, pois em um desastre o banco pode estar fora do ar.
- Logs em texto legível no stdout (stdlib `logging`); não usa o JSONL do app.

Agenda: uma vez por dia num HORÁRIO FIXO (`BACKUP_AT`, ex.: 03:00 da madrugada), no
fuso do contêiner (`TZ`). Faz pg_dump -> gzip -> upload S3 -> retenção. QUALQUER
falha (conexão, dump, upload, etc.) dispara um e-mail de alerta para o admin.
"""

import gzip
import logging
import os
import smtplib
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [backup] %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("backup")


def _env(name: str, default: str | None = None, required: bool = False) -> str | None:
    value = os.environ.get(name, default)
    if required and not value:
        log.error("variável de ambiente obrigatória ausente: %s", name)
        sys.exit(2)
    return value


def _flag(name: str, default: str) -> bool:
    return (os.environ.get(name, default) or "").strip().lower() in ("1", "true", "yes", "on")


# --- Postgres (para o pg_dump) ---
PG_HOST = _env("POSTGRES_HOST", "postgres")
PG_PORT = _env("POSTGRES_PORT", "5432")
PG_DB = _env("POSTGRES_DB", "aurora")
PG_USER = _env("POSTGRES_USER", "aurora")
PG_PASSWORD = _env("POSTGRES_PASSWORD", "") or ""

# --- Destino S3 (config PRÓPRIA, nunca a do banco) ---
S3_ENDPOINT = _env("BACKUP_S3_ENDPOINT")  # vazio = AWS S3 padrão
S3_REGION = _env("BACKUP_S3_REGION", "us-east-1")
S3_BUCKET = _env("BACKUP_S3_BUCKET", required=True)
S3_ACCESS_KEY = _env("BACKUP_S3_ACCESS_KEY", required=True)
S3_SECRET_KEY = _env("BACKUP_S3_SECRET_KEY", required=True)
S3_PREFIX = (_env("BACKUP_S3_PREFIX", "backups/") or "").lstrip("/")
S3_USE_SSL = _flag("BACKUP_S3_USE_SSL", "true")

# --- Agendamento e retenção ---
# BACKUP_AT = "HH:MM" (horário fixo diário, no fuso TZ do contêiner). Vazio cai no
# modo intervalo (BACKUP_INTERVAL_SECONDS), por compatibilidade.
BACKUP_AT = (_env("BACKUP_AT", "03:00") or "").strip()
INTERVAL_SECONDS = int(_env("BACKUP_INTERVAL_SECONDS", "86400") or "86400")
RETENTION_DAYS = int(_env("BACKUP_RETENTION_DAYS", "14") or "14")
RUN_ON_START = _flag("BACKUP_RUN_ON_START", "true")

# --- Alerta por e-mail (SMTP PRÓPRIO do backup) ---
SMTP_HOST = _env("BACKUP_SMTP_HOST")
SMTP_PORT = int(_env("BACKUP_SMTP_PORT", "587") or "587")
SMTP_USER = _env("BACKUP_SMTP_USERNAME")
SMTP_PASSWORD = _env("BACKUP_SMTP_PASSWORD", "") or ""
SMTP_FROM = _env("BACKUP_SMTP_FROM") or SMTP_USER
SMTP_USE_TLS = _flag("BACKUP_SMTP_USE_TLS", "true")
ALERT_EMAIL = _env("BACKUP_ALERT_EMAIL")  # e-mail do admin geral


def _send_alert(subject: str, body: str) -> None:
    """Envia um e-mail de alerta ao admin. Nunca levanta (só loga se falhar)."""
    if not (SMTP_HOST and ALERT_EMAIL and SMTP_FROM):
        log.warning("alerta NÃO enviado (BACKUP_SMTP_* / BACKUP_ALERT_EMAIL não configurados): %s", subject)
        return
    try:
        msg = EmailMessage()
        msg["From"] = SMTP_FROM
        msg["To"] = ALERT_EMAIL
        msg["Subject"] = subject
        msg.set_content(body)
        if SMTP_PORT == 465:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30) as srv:
                if SMTP_USER:
                    srv.login(SMTP_USER, SMTP_PASSWORD)
                srv.send_message(msg)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as srv:
                if SMTP_USE_TLS:
                    srv.starttls()
                if SMTP_USER:
                    srv.login(SMTP_USER, SMTP_PASSWORD)
                srv.send_message(msg)
        log.info("alerta de falha enviado para %s", ALERT_EMAIL)
    except Exception as exc:  # não deixa o alerta derrubar o serviço
        log.error("não foi possível enviar o alerta por e-mail: %s", exc)


def _s3_client():
    import boto3
    from botocore.config import Config

    kwargs = dict(
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name=S3_REGION,
        config=Config(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"}),
    )
    if S3_ENDPOINT:  # MinIO/compatível
        kwargs["endpoint_url"] = S3_ENDPOINT
        kwargs["use_ssl"] = S3_USE_SSL
    return boto3.client("s3", **kwargs)


def _pg_env() -> dict:
    return {**os.environ, "PGPASSWORD": PG_PASSWORD}


def _dump_to(path: str) -> None:
    """Executa o pg_dump (formato plain) comprimindo em gzip para `path`."""
    cmd = [
        "pg_dump", "-h", str(PG_HOST), "-p", str(PG_PORT), "-U", str(PG_USER),
        "-d", str(PG_DB), "--no-owner", "--no-privileges",
    ]
    log.info("pg_dump iniciado: %s@%s:%s/%s", PG_USER, PG_HOST, PG_PORT, PG_DB)
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=_pg_env())
    assert proc.stdout is not None
    with open(path, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb") as gz:
        for chunk in iter(lambda: proc.stdout.read(65536), b""):
            gz.write(chunk)
    _, stderr = proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"pg_dump falhou (código {proc.returncode}): {stderr.decode(errors='replace')[:800]}")
    if os.path.getsize(path) == 0:
        raise RuntimeError("pg_dump gerou um arquivo vazio")


def _prune(client) -> None:
    """Remove backups mais antigos que a retenção."""
    if RETENTION_DAYS <= 0:
        return
    cutoff = datetime.now(UTC) - timedelta(days=RETENTION_DAYS)
    deleted = 0
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=S3_PREFIX):
        for obj in page.get("Contents", []):
            if obj["LastModified"] < cutoff:
                client.delete_object(Bucket=S3_BUCKET, Key=obj["Key"])
                deleted += 1
    if deleted:
        log.info("retenção: %s backup(s) com mais de %s dia(s) removido(s)", deleted, RETENTION_DAYS)


def run_once() -> None:
    ts = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    key = f"{S3_PREFIX}{PG_DB}-{ts}.sql.gz"
    client = _s3_client()
    with tempfile.NamedTemporaryFile(suffix=".sql.gz") as tmp:
        _dump_to(tmp.name)
        size_kb = os.path.getsize(tmp.name) / 1024
        log.info("enviando backup (%.1f KB) -> s3://%s/%s", size_kb, S3_BUCKET, key)
        client.upload_file(tmp.name, S3_BUCKET, key)
    log.info("backup concluído: s3://%s/%s", S3_BUCKET, key)
    _prune(client)


def _cycle() -> None:
    """Um ciclo de backup. Em qualquer falha, loga e alerta o admin por e-mail."""
    try:
        run_once()
    except Exception as exc:
        log.error("ciclo de backup falhou: %s", exc)
        _send_alert(
            "[Aurora NetTools] FALHA no backup diário do banco",
            "O backup automático do banco de dados FALHOU.\n\n"
            f"Erro: {exc}\n\n"
            f"Quando: {datetime.now().isoformat(timespec='seconds')}\n"
            f"Origem: {PG_USER}@{PG_HOST}:{PG_PORT}/{PG_DB}\n"
            f"Destino: s3://{S3_BUCKET}/{S3_PREFIX}\n\n"
            "Verifique o serviço de backup o quanto antes.",
        )


def _wait_for_postgres(timeout: int = 180) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = subprocess.run(
            ["pg_isready", "-h", str(PG_HOST), "-p", str(PG_PORT), "-U", str(PG_USER)],
            capture_output=True, env=_pg_env(),
        )
        if r.returncode == 0:
            return True
        time.sleep(3)
    return False


def _parse_at(value: str) -> tuple[int, int]:
    try:
        hh, mm = value.split(":")
        h, m = int(hh), int(mm)
        if 0 <= h <= 23 and 0 <= m <= 59:
            return h, m
    except Exception:
        pass
    log.error("BACKUP_AT inválido (%r) — usando 03:00", value)
    return 3, 0


def _sleep_until_next() -> None:
    """Dorme até o próximo horário fixo (BACKUP_AT) ou o intervalo (compat)."""
    if BACKUP_AT:
        hh, mm = _parse_at(BACKUP_AT)
        now = datetime.now()  # hora local (respeita TZ do contêiner)
        nxt = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if nxt <= now:
            nxt += timedelta(days=1)
        secs = (nxt - now).total_seconds()
        log.info("próximo backup agendado para %s (em %.1f h)", nxt.strftime("%Y-%m-%d %H:%M"), secs / 3600)
        time.sleep(secs)
    else:
        log.info("próximo backup em %.1f h (intervalo)", INTERVAL_SECONDS / 3600)
        time.sleep(INTERVAL_SECONDS)


def main() -> None:
    schedule = f"todo dia às {BACKUP_AT} ({time.tzname[0]})" if BACKUP_AT else f"a cada {INTERVAL_SECONDS}s"
    log.info(
        "iniciado | origem=%s@%s:%s/%s | destino=s3://%s/%s | endpoint=%s | agenda=%s | retenção=%sd | alerta=%s",
        PG_USER, PG_HOST, PG_PORT, PG_DB, S3_BUCKET, S3_PREFIX, S3_ENDPOINT or "(AWS)", schedule, RETENTION_DAYS,
        ALERT_EMAIL or "(desligado)",
    )
    if not _wait_for_postgres():
        log.error("Postgres indisponível dentro do tempo limite — encerrando")
        _send_alert(
            "[Aurora NetTools] backup NÃO iniciou",
            f"O serviço de backup não conseguiu conectar ao Postgres em {PG_HOST}:{PG_PORT} e será encerrado.",
        )
        sys.exit(1)
    if RUN_ON_START:
        log.info("BACKUP_RUN_ON_START ligado — executando um backup inicial agora")
        _cycle()
    while True:
        _sleep_until_next()
        _cycle()


if __name__ == "__main__":
    main()
