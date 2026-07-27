"""organization.trial_expires_at (elegibilidade ao plano de teste)

Revision ID: a7f3d1c9e2b4
Revises: f2a3b4c5d6e7
Create Date: 2026-07-27 16:00:00.000000
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "a7f3d1c9e2b4"
down_revision: str | None = "f2a3b4c5d6e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("organization", sa.Column("trial_expires_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("organization", "trial_expires_at")
