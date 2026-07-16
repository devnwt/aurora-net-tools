"""copilot: reasoning na mensagem + contadores de tokens na conversa

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-07-14 17:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("copilot_message", sa.Column("reasoning", sa.Text(), nullable=True))
    op.add_column("copilot_conversation", sa.Column("tokens_total", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("copilot_conversation", sa.Column("tokens_context", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("copilot_conversation", "tokens_context")
    op.drop_column("copilot_conversation", "tokens_total")
    op.drop_column("copilot_message", "reasoning")
