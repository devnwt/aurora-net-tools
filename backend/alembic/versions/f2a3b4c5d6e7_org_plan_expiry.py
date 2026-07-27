"""organization.plan_expires_at (vencimento) e plan_canceled (cancelado)

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-07-27 15:00:00.000000
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "f2a3b4c5d6e7"
down_revision: str | None = "e1f2a3b4c5d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("organization", sa.Column("plan_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "organization",
        sa.Column("plan_canceled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("organization", "plan_canceled")
    op.drop_column("organization", "plan_expires_at")
