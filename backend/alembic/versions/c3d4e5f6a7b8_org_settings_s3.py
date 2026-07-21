"""org_settings: integração MinIO / S3

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-14 14:00:00.000000
"""
from typing import Union
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "c3d4e5f6a7b8"
down_revision: str | None = "b2c3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("org_settings", sa.Column("s3_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("org_settings", sa.Column("s3_endpoint", sa.String(length=255), nullable=False, server_default=""))
    op.add_column("org_settings", sa.Column("s3_region", sa.String(length=64), nullable=False, server_default="us-east-1"))
    op.add_column("org_settings", sa.Column("s3_bucket", sa.String(length=255), nullable=False, server_default=""))
    op.add_column("org_settings", sa.Column("s3_access_key", sa.String(length=255), nullable=False, server_default=""))
    op.add_column("org_settings", sa.Column("s3_secret_key", sa.String(length=512), nullable=False, server_default=""))
    op.add_column("org_settings", sa.Column("s3_prefix", sa.String(length=255), nullable=False, server_default=""))
    op.add_column("org_settings", sa.Column("s3_use_ssl", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    for col in ("s3_use_ssl", "s3_prefix", "s3_secret_key", "s3_access_key", "s3_bucket", "s3_region", "s3_endpoint", "s3_enabled"):
        op.drop_column("org_settings", col)
