# backup — serviço de backup do Postgres

Contêiner **dedicado e isolado** que faz `pg_dump` do banco e envia para um S3
**próprio**. Independente do app: não importa nada de `backend/app`, não usa a
config de S3 que vive no banco (`org_settings`) e roda como usuário não-root.

## Como funciona

Todo dia, num **horário fixo de madrugada** (`BACKUP_AT`, padrão `03:00` no fuso
`TZ`): `pg_dump` (formato plain, comprimido em gzip) → upload para
`s3://<bucket>/<prefix><db>-<timestamp>.sql.gz` → aplica retenção. Logs em texto
no stdout.

**Em qualquer falha** (Postgres fora do ar, `pg_dump`, upload, etc.) é enviado um
**e-mail de alerta** para o admin (`BACKUP_ALERT_EMAIL`) via SMTP próprio, e o
serviço segue tentando no próximo horário.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `POSTGRES_HOST` / `POSTGRES_PORT` | `postgres` / `5432` | Servidor a copiar |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | `aurora` / `aurora` / — | Credenciais do dump |
| `BACKUP_S3_BUCKET` | — (obrigatório) | Bucket de destino |
| `BACKUP_S3_ACCESS_KEY` / `BACKUP_S3_SECRET_KEY` | — (obrigatório) | Credenciais do S3 |
| `BACKUP_S3_ENDPOINT` | vazio = AWS | Endpoint (ex.: MinIO `https://minio:9000`) |
| `BACKUP_S3_REGION` | `us-east-1` | Região |
| `BACKUP_S3_PREFIX` | `backups/` | Prefixo das chaves |
| `BACKUP_S3_USE_SSL` | `true` | TLS ao usar endpoint próprio |
| `TZ` | `America/Sao_Paulo` | Fuso que rege o horário do agendamento |
| `BACKUP_AT` | `03:00` | **Horário fixo diário** (HH:MM). Vazio → usa `BACKUP_INTERVAL_SECONDS` |
| `BACKUP_INTERVAL_SECONDS` | `86400` | Intervalo (só se `BACKUP_AT` vazio; compat.) |
| `BACKUP_RETENTION_DAYS` | `14` | Remove backups mais antigos que N dias (0 = nunca) |
| `BACKUP_RUN_ON_START` | `true` | Faz um backup imediato ao subir, além do horário fixo |
| `BACKUP_ALERT_EMAIL` | — | E-mail do admin que recebe os alertas de falha (vazio = desliga) |
| `BACKUP_SMTP_HOST` | — | Servidor SMTP para os alertas (vazio = desliga) |
| `BACKUP_SMTP_PORT` | `587` | `465` = SSL; `587` = STARTTLS |
| `BACKUP_SMTP_USERNAME` / `BACKUP_SMTP_PASSWORD` | — | Credenciais SMTP (opcional) |
| `BACKUP_SMTP_FROM` | = username | Remetente do alerta |
| `BACKUP_SMTP_USE_TLS` | `true` | STARTTLS (ignorado na porta 465, que já é SSL) |

> As credenciais de S3 e de SMTP aqui são **próprias do backup** — de propósito
> separadas das do app, para que a rotina não dependa do banco estar no ar.

## Restauração

```sh
gunzip -c aurora-<timestamp>.sql.gz | psql -h <host> -U <user> -d <db>
```

## Build / execução

Sobe junto do compose (serviço `backup`). Avulso:

```sh
docker build -t aurora-backup ./backup
docker run --rm --network <rede_do_compose> \
  -e POSTGRES_HOST=postgres -e POSTGRES_PASSWORD=... \
  -e BACKUP_S3_BUCKET=... -e BACKUP_S3_ACCESS_KEY=... -e BACKUP_S3_SECRET_KEY=... \
  -e BACKUP_S3_ENDPOINT=https://minio:9000 aurora-backup
```
