"""user.token_version — invalida JWTs em logout-all / reset / desativação

Revision ID: a8b9c0d1e2f3
Revises: b2d4f6a8c1e3
Create Date: 2026-07-29 14:00:00.000000
"""
from typing import Union
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "a8b9c0d1e2f3"
down_revision: str | None = "b2d4f6a8c1e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("user", "token_version")
