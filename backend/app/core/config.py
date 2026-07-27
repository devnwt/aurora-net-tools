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
    jwt_expire_minutes: int = 480
    admin_username: str = "admin"
    admin_email: str = ""  # login por e-mail do Master (semeado no 1º boot)
    admin_password: str = ""

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

    # Observabilidade — logs brutos em JSONL (fonte da aba /logs → Observabilidade).
    # O diretório é montado por volume no compose; se não for gravável, a
    # aplicação segue normalmente e só o arquivo deixa de existir.
    log_dir: str = "/app/log"
    log_file_level: str = "WARNING"  # o que vai pro arquivo (stdout continua INFO)
    log_max_bytes: int = 10 * 1024 * 1024  # rotação por tamanho
    log_backup_count: int = 5  # events.jsonl.1 .. .5 (~60MB no pior caso)

    # Testes — usa NullPool para evitar conexões presas a um event loop
    testing: bool = False

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
