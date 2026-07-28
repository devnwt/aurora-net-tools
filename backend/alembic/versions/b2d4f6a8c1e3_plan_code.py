"""plan.code (plan_code no hub de cobrança)

Revision ID: b2d4f6a8c1e3
Revises: a1c2e3f4b5d6
Create Date: 2026-07-28 17:00:00.000000
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "b2d4f6a8c1e3"
down_revision: str | None = "a1c2e3f4b5d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("plan", sa.Column("code", sa.String(length=60), nullable=True))


def downgrade() -> None:
    op.drop_column("plan", "code")
