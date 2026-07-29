"""user.name (nome do titular, coletado no cadastro)

Revision ID: a1c2e3f4b5d6
Revises: f7b2c1d9e3a4
Create Date: 2026-07-28 16:30:00.000000
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "a1c2e3f4b5d6"
down_revision: str | None = "f7b2c1d9e3a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("user", sa.Column("name", sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column("user", "name")
