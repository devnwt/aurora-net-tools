"""add location to device_group (Sites)

Revision ID: c1a2b3d4e5f6
Revises: b04a07162f7a
Create Date: 2026-06-29 14:00:00.000000
"""
from typing import Union
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "c1a2b3d4e5f6"
down_revision: str | None = "b04a07162f7a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "device_group",
        sa.Column("location", sa.String(length=200), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("device_group", "location")
