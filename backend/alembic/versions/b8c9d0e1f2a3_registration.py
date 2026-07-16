"""org_settings: cadastro público (registration_enabled + plan)

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-07-15 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("org_settings", sa.Column("registration_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("org_settings", sa.Column("registration_plan_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_org_settings_reg_plan", "org_settings", "plan", ["registration_plan_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint("fk_org_settings_reg_plan", "org_settings", type_="foreignkey")
    op.drop_column("org_settings", "registration_plan_id")
    op.drop_column("org_settings", "registration_enabled")
