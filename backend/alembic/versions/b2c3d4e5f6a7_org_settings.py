"""org_settings: integrações SMTP / FTP / LLM por ORG

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-14 12:00:00.000000
"""
from typing import Union
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "b2c3d4e5f6a7"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "org_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=True),
        # SMTP
        sa.Column("smtp_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("smtp_host", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("smtp_port", sa.Integer(), nullable=False, server_default="587"),
        sa.Column("smtp_username", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("smtp_password", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("smtp_from", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("smtp_use_tls", sa.Boolean(), nullable=False, server_default=sa.true()),
        # FTP
        sa.Column("ftp_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("ftp_host", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("ftp_port", sa.Integer(), nullable=False, server_default="21"),
        sa.Column("ftp_username", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("ftp_password", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("ftp_path", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("ftp_use_tls", sa.Boolean(), nullable=False, server_default=sa.false()),
        # LLM
        sa.Column("llm_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("llm_base_url", sa.String(length=500), nullable=False, server_default="https://api.openai.com/v1"),
        sa.Column("llm_api_key", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("llm_model", sa.String(length=120), nullable=False, server_default="gpt-4o-mini"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["organization.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id", name="uq_org_settings_org_id"),
    )
    op.create_index(op.f("ix_org_settings_org_id"), "org_settings", ["org_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_org_settings_org_id"), table_name="org_settings")
    op.drop_table("org_settings")
