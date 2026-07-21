"""device_sample time-series (Health charts)

Revision ID: e3c4d5f6a7b8
Revises: d2b3c4e5f6a7
Create Date: 2026-06-29 16:00:00.000000
"""
from typing import Union
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "e3c4d5f6a7b8"
down_revision: str | None = "d2b3c4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "device_sample",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cpu_load", sa.Integer(), nullable=True),
        sa.Column("ram_used_pct", sa.Integer(), nullable=True),
        sa.Column("temperature", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(["device_id"], ["device.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_device_sample_device_id"), "device_sample", ["device_id"], unique=False)
    op.create_index(op.f("ix_device_sample_ts"), "device_sample", ["ts"], unique=False)
    op.create_index("ix_device_sample_device_ts", "device_sample", ["device_id", "ts"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_device_sample_device_ts", table_name="device_sample")
    op.drop_index(op.f("ix_device_sample_ts"), table_name="device_sample")
    op.drop_index(op.f("ix_device_sample_device_id"), table_name="device_sample")
    op.drop_table("device_sample")
