"""charge.checkout_url (reaproveitar link de pagamento — dedup de cobrança)

Revision ID: d4f6a8b0c2e5
Revises: c3e5a7b9d1f4
Create Date: 2026-07-30 12:00:00.000000
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "d4f6a8b0c2e5"
down_revision: str | None = "c3e5a7b9d1f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("charge", sa.Column("checkout_url", sa.String(length=512), nullable=True))


def downgrade() -> None:
    op.drop_column("charge", "checkout_url")
