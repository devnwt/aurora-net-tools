from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TimestampMixin


class OrgSettings(Base, TimestampMixin):
    """Integrações por ORG: SMTP, FTP e LLM (OpenAI-compatible).

    Uma linha por ORG (org_id único; master usa org_id NULL = global).
    Segredos (senhas / api-key) são armazenados cifrados (Fernet).
    """

    __tablename__ = "org_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=True, unique=True, index=True
    )

    # --- SMTP ---
    smtp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    smtp_host: Mapped[str] = mapped_column(String(255), default="")
    smtp_port: Mapped[int] = mapped_column(Integer, default=587)
    smtp_username: Mapped[str] = mapped_column(String(255), default="")
    smtp_password: Mapped[str] = mapped_column(String(512), default="")  # cifrado
    smtp_from: Mapped[str] = mapped_column(String(255), default="")
    smtp_use_tls: Mapped[bool] = mapped_column(Boolean, default=True)

    # --- FTP ---
    ftp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    ftp_host: Mapped[str] = mapped_column(String(255), default="")
    ftp_port: Mapped[int] = mapped_column(Integer, default=21)
    ftp_username: Mapped[str] = mapped_column(String(255), default="")
    ftp_password: Mapped[str] = mapped_column(String(512), default="")  # cifrado
    ftp_path: Mapped[str] = mapped_column(String(500), default="")
    ftp_use_tls: Mapped[bool] = mapped_column(Boolean, default=False)  # FTPS explícito

    # --- MinIO / S3 ---
    s3_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    s3_endpoint: Mapped[str] = mapped_column(String(255), default="")  # host:port ou URL completa
    s3_region: Mapped[str] = mapped_column(String(64), default="us-east-1")
    s3_bucket: Mapped[str] = mapped_column(String(255), default="")
    s3_access_key: Mapped[str] = mapped_column(String(255), default="")  # identificador (como username)
    s3_secret_key: Mapped[str] = mapped_column(String(512), default="")  # cifrado
    s3_prefix: Mapped[str] = mapped_column(String(255), default="")  # prefixo de chave (pasta)
    s3_use_ssl: Mapped[bool] = mapped_column(Boolean, default=True)

    # --- Cadastro público (self-signup de tenant) — global (org NULL) ---
    registration_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    registration_plan_id: Mapped[int | None] = mapped_column(
        ForeignKey("plan.id", ondelete="SET NULL"), nullable=True
    )

    # --- Copilot: ferramentas embutidas (habilitadas por padrão) ---
    copilot_web_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    copilot_web_url: Mapped[str] = mapped_column(String(255), default="")  # instância SearXNG
    copilot_fs_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    copilot_fs_root: Mapped[str] = mapped_column(String(255), default="/tmp")

    # --- LLM (OpenAI-compatible) ---
    llm_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    llm_base_url: Mapped[str] = mapped_column(String(500), default="https://api.openai.com/v1")
    llm_api_key: Mapped[str] = mapped_column(String(512), default="")  # cifrado
    llm_model: Mapped[str] = mapped_column(String(120), default="gpt-4o-mini")
