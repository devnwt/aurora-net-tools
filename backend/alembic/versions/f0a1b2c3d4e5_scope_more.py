"""org_id em controller/template/webhook/api_key/audit_log

Revision ID: f0a1b2c3d4e5
Revises: e9f0a1b2c3d4
Create Date: 2026-07-13 16:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f0a1b2c3d4e5"
down_revision: Union[str, None] = "e9f0a1b2c3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("controller", "command_template", "webhook", "api_key", "audit_log")


def upgrade() -> None:
    for t in _TABLES:
        op.add_column(t, sa.Column("org_id", sa.Integer(), nullable=True))
        op.create_foreign_key(f"fk_{t}_org", t, "organization", ["org_id"], ["id"], ondelete="CASCADE")
        op.create_index(f"ix_{t}_org_id", t, ["org_id"], unique=False)


def downgrade() -> None:
    for t in _TABLES:
        op.drop_index(f"ix_{t}_org_id", table_name=t)
        op.drop_constraint(f"fk_{t}_org", t, type_="foreignkey")
        op.drop_column(t, "org_id")
