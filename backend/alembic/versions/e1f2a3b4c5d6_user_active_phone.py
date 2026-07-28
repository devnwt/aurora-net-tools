"""user.is_active (conta ativa) e user.phone (telefone)

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-07-27 14:00:00.000000
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "e1f2a3b4c5d6"
down_revision: str | None = "d0e1f2a3b4c5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Contas existentes ficam ativas (server_default true) — ninguém é bloqueado.
    op.add_column(
        "user",
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.add_column("user", sa.Column("phone", sa.String(length=30), nullable=True))


def downgrade() -> None:
    op.drop_column("user", "phone")
    op.drop_column("user", "is_active")
