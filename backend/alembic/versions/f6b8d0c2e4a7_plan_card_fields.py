"""plan: price_cents, promo_price_cents, description, sort_order (infos do card)

Revision ID: f6b8d0c2e4a7
Revises: e5a7c9b1d3f6
Create Date: 2026-07-30 19:00:00.000000
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "f6b8d0c2e4a7"
down_revision: str | None = "e5a7c9b1d3f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("plan", sa.Column("price_cents", sa.Integer(), nullable=True))
    op.add_column("plan", sa.Column("promo_price_cents", sa.Integer(), nullable=True))
    op.add_column("plan", sa.Column("description", sa.String(length=255), nullable=True))
    op.add_column("plan", sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")))


def downgrade() -> None:
    op.drop_column("plan", "sort_order")
    op.drop_column("plan", "description")
    op.drop_column("plan", "promo_price_cents")
    op.drop_column("plan", "price_cents")
