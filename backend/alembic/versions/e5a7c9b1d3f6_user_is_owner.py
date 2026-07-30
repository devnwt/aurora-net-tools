"""user.is_owner (admin criador da conta — não excluível pela lista)

Revision ID: e5a7c9b1d3f6
Revises: d4f6a8b0c2e5
Create Date: 2026-07-30 18:00:00.000000
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "e5a7c9b1d3f6"
down_revision: str | None = "d4f6a8b0c2e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column("is_owner", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    # Backfill: o usuário mais antigo (menor id) de cada ORG é o criador da conta.
    op.execute(
        'UPDATE "user" SET is_owner = true WHERE id IN '
        '(SELECT MIN(id) FROM "user" WHERE org_id IS NOT NULL GROUP BY org_id)'
    )


def downgrade() -> None:
    op.drop_column("user", "is_owner")
