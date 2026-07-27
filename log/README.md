# Logs brutos da aplicação

Diretório montado em `/app/log` dentro do container do backend (ver `volumes:` no
`docker-compose*.yml`). **O conteúdo não é versionado** — só este README e o
`.gitkeep`.

## Arquivos

| Arquivo | Conteúdo |
| --- | --- |
| `events.jsonl` | Eventos correntes, **uma linha JSON por evento** |
| `events.jsonl.1` … `.5` | Backups da rotação (10 MB cada, ~60 MB no total) |

Quem escreve é `backend/app/core/logging.py`; quem lê é
`backend/app/services/observability.py`, exposto em `/observability/*` **apenas
para o Admin Master** e apresentado na aba *Observabilidade* de `/logs`.

## Formato

```json
{"id":"9f2c…","ts":"2026-07-24T12:00:00+00:00","level":"ERROR","logger":"aurora",
 "service":"api","message":"erro não tratado em GET /devices","request_id":"a1b2c3d4",
 "method":"GET","path":"/devices","status":500,"user":"admin","org_id":3,
 "error_type":"TimeoutError","stack":"Traceback…"}
```

Nível mínimo gravado: `LOG_FILE_LEVEL` (padrão `WARNING`). O stdout continua em
`INFO` — `docker compose logs backend` segue mostrando tudo.

## Segurança

Senhas, tokens, chaves de API, `Authorization`, JWTs, credenciais em DSN e a
parte local de e-mails passam por redação antes de virar linha no arquivo
(`redact()` em `app/core/logging.py`). Os arquivos são de investigação técnica —
nunca são servidos crus ao usuário final.
