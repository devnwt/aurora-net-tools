"""user.photo (avatar do perfil, data URL base64)

Revision ID: d3f4a5b6c7e8
Revises: c4a9f1b7d2e3
Create Date: 2026-07-28 12:00:00.000000
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "d3f4a5b6c7e8"
down_revision: str | None = "c4a9f1b7d2e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("user", sa.Column("photo", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("user", "photo")
