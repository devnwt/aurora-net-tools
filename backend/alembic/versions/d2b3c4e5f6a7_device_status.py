"""device_status snapshot (poller)

Revision ID: d2b3c4e5f6a7
Revises: c1a2b3d4e5f6
Create Date: 2026-06-29 15:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d2b3c4e5f6a7"
down_revision: Union[str, None] = "c1a2b3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "device_status",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="unknown"),
        sa.Column("cpu_load", sa.String(length=16), nullable=True),
        sa.Column("ram_used_pct", sa.Integer(), nullable=True),
        sa.Column("temperature", sa.String(length=16), nullable=True),
        sa.Column("uptime", sa.String(length=64), nullable=True),
        sa.Column("version", sa.String(length=64), nullable=True),
        sa.Column("board", sa.String(length=64), nullable=True),
        sa.Column("current_firmware", sa.String(length=64), nullable=True),
        sa.Column("upgrade_firmware", sa.String(length=64), nullable=True),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["device_id"], ["device.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_device_status_device_id"), "device_status", ["device_id"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_device_status_device_id"), table_name="device_status")
    op.drop_table("device_status")
