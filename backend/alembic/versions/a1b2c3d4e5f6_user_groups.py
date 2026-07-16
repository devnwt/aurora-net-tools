"""user_group + user.usergroup_id

Revision ID: a1b2c3d4e5f6
Revises: f0a1b2c3d4e5
Create Date: 2026-07-13 20:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "f0a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_group",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("parent_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_id"], ["user_group.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_group_org_id"), "user_group", ["org_id"], unique=False)
    op.create_index(op.f("ix_user_group_parent_id"), "user_group", ["parent_id"], unique=False)

    op.add_column("user", sa.Column("usergroup_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_user_usergroup", "user", "user_group", ["usergroup_id"], ["id"], ondelete="SET NULL")
    op.create_index(op.f("ix_user_usergroup_id"), "user", ["usergroup_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_user_usergroup_id"), table_name="user")
    op.drop_constraint("fk_user_usergroup", "user", type_="foreignkey")
    op.drop_column("user", "usergroup_id")
    op.drop_index(op.f("ix_user_group_parent_id"), table_name="user_group")
    op.drop_index(op.f("ix_user_group_org_id"), table_name="user_group")
    op.drop_table("user_group")
