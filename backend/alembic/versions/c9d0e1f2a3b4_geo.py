"""geolocalização: lat/lon em device e device_group

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-07-15 14:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("device", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("device", sa.Column("longitude", sa.Float(), nullable=True))
    op.add_column("device_group", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("device_group", sa.Column("longitude", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("device_group", "longitude")
    op.drop_column("device_group", "latitude")
    op.drop_column("device", "longitude")
    op.drop_column("device", "latitude")
