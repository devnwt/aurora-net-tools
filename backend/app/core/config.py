from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuração da aplicação, carregada de variáveis de ambiente / .env."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    app_name: str = "Aurora Nettools"
    app_secret_key: str  # chave Fernet para cifrar segredos (obrigatória)
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    # Access token curto; renovação via refresh_token (Redis). Logout/reset invalidam.
    jwt_expire_minutes: int = 15
    jwt_refresh_expire_days: int = 7
    # Cookies HttpOnly (AUTH-003). cookie_secure=True exige HTTPS no browser.
    cookie_secure: bool = False
    cookie_samesite: str = "lax"  # lax | strict | none
    cookie_path: str = "/"
    # Origens CORS com credenciais (vírgula). Vazio = same-origin via proxy (* sem credentials).
    cors_origins: str = ""
    admin_username: str = "admin"
    admin_email: str = ""  # login por e-mail do Master (semeado no 1º boot)
    admin_password: str = ""
    # Link de suporte (ex.: https://wa.me/55DDDNUMERO). Vazio = botão de suporte oculto.
    support_whatsapp_url: str = ""

    # Backend / MCP
    host: str = "0.0.0.0"
    port: int = 8000
    mcp_transport: str = "streamable-http"
    mcp_path: str = "/mcp"

    # Postgres
    postgres_host: str = "postgres"
    postgres_port: int = 5432
    postgres_db: str = "aurora"
    postgres_user: str = "aurora"
    postgres_password: str = "aurora"

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # SNMP
    mibs_path: str = "/app/mibs"

    # Poller de status RouterOS (background)
    poll_enabled: bool = True
    poll_interval_seconds: int = 60
    poll_concurrency: int = 4
    sample_retention_days: int = 30

    # Gerador de notificações de trial/expiração (background)
    notify_enabled: bool = True
    notify_interval_seconds: int = 3600  # 1x por hora basta para faixas de dias

    # Reconciliação de pagamentos (consulta o hub p/ confirmar cobranças pendentes).
    billing_reconcile_enabled: bool = True
    billing_reconcile_seconds: int = 120
    # Dedup de checkout: reaproveita uma cobrança pending recente do mesmo (org, plano)
    # em vez de criar outra (evita cobrança duplicada em duplo-clique / volta do browser).
    billing_checkout_reuse_minutes: int = 30
    # Alerta: se o reconciliador falhar N ciclos seguidos (hub indisponível), avisa por
    # e-mail. Destinatário: billing_alert_email ou, vazio, o admin_email (Master).
    billing_alert_fail_cycles: int = 3
    billing_alert_email: str = ""

    # Proteção de login (rate limiting + lockout + backoff, contadores no Redis).
    # Desligado automaticamente quando testing=True (ver loginguard._enabled).
    login_protection_enabled: bool = True
    login_ip_max_attempts: int = 10       # tentativas de login por IP na janela
    login_ip_window_seconds: int = 300    # janela do limite por IP (5 min)
    login_account_max_failures: int = 5   # falhas por conta antes do lockout
    login_account_window_seconds: int = 900  # janela de contagem de falhas (15 min)
    login_lockout_seconds: int = 900      # duração do bloqueio temporário (15 min)
    login_backoff_max_seconds: float = 2.0   # atraso progressivo máximo por falha
    # Limite genérico por IP para endpoints sensíveis (forgot/reset/register/reactivate).
    auth_ip_max_requests: int = 20
    auth_ip_window_seconds: int = 300

    # Verificação de e-mail no cadastro (código enviado por SMTP). Requer SMTP global
    # configurado; sem SMTP (ou em testing) o cadastro cai no fluxo direto.
    email_verification_enabled: bool = True

    # Observabilidade — logs brutos em JSONL (fonte da aba /logs → Observabilidade).
    # O diretório é montado por volume no compose; se não for gravável, a
    # aplicação segue normalmente e só o arquivo deixa de existir.
    log_dir: str = "/app/log"
    log_file_level: str = "WARNING"  # o que vai pro arquivo (stdout continua INFO)
    log_max_bytes: int = 10 * 1024 * 1024  # rotação por tamanho
    log_backup_count: int = 5  # events.jsonl.1 .. .5 (~60MB no pior caso)
    # Prometheus /metrics (RED + gauges Postgres/Redis). Desligue só se necessário.
    metrics_enabled: bool = True

    # Testes — usa NullPool para evitar conexões presas a um event loop
    testing: bool = False

    # Hub de cobrança (checkout de planos pagos). Vazio (token) = checkout desligado.
    hub_aurora_url: str = "https://hub.admin.aurora.api.br/"
    hub_aurora_token: str = ""

    # Seed do controller Fiberhome (UNM2000)
    tl1_host: str = ""
    tl1_port: int = 3337
    tl1_username: str = ""
    tl1_password: str = ""

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
