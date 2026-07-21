"""device_backup (config export)

Revision ID: a5b6c7d8e9f0
Revises: f4d5e6a7b8c9
Create Date: 2026-07-04 18:00:00.000000
"""
from typing import Union
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "a5b6c7d8e9f0"
down_revision: str | None = "f4d5e6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "device_backup",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(["device_id"], ["device.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_device_backup_device_id"), "device_backup", ["device_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_device_backup_device_id"), table_name="device_backup")
    op.drop_table("device_backup")
