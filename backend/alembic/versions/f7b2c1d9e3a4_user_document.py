"""user.document (CPF/CNPJ do titular, só dígitos — necessário no checkout)

Revision ID: f7b2c1d9e3a4
Revises: d3f4a5b6c7e8
Create Date: 2026-07-28 16:00:00.000000
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "f7b2c1d9e3a4"
down_revision: str | None = "d3f4a5b6c7e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("user", sa.Column("document", sa.String(length=14), nullable=True))


def downgrade() -> None:
    op.drop_column("user", "document")
