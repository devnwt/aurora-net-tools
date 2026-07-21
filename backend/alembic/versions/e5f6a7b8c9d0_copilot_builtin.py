"""org_settings: ferramentas embutidas do Copilot (SearXNG + filesystem)

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-07-14 16:00:00.000000
"""
from typing import Union
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "e5f6a7b8c9d0"
down_revision: str | None = "d4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("org_settings", sa.Column("copilot_web_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("org_settings", sa.Column("copilot_web_url", sa.String(length=255), nullable=False, server_default=""))
    op.add_column("org_settings", sa.Column("copilot_fs_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("org_settings", sa.Column("copilot_fs_root", sa.String(length=255), nullable=False, server_default="/tmp"))


def downgrade() -> None:
    for col in ("copilot_fs_root", "copilot_fs_enabled", "copilot_web_url", "copilot_web_enabled"):
        op.drop_column("org_settings", col)
