"""multi-tenancy: plan, organization, org_id/role

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-07-12 12:00:00.000000
"""
from typing import Union
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "d8e9f0a1b2c3"
down_revision: str | None = "c7d8e9f0a1b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "plan",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("max_devices", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("max_users", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "organization",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("plan_id", sa.Integer(), nullable=True),
        sa.Column("device_limit", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["plan_id"], ["plan.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )

    # user: role + org_id
    op.add_column("user", sa.Column("role", sa.String(length=20), nullable=False, server_default="operator"))
    op.add_column("user", sa.Column("org_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_user_org", "user", "organization", ["org_id"], ["id"], ondelete="CASCADE")
    op.create_index(op.f("ix_user_org_id"), "user", ["org_id"], unique=False)
    op.execute("UPDATE \"user\" SET role = CASE WHEN is_admin THEN 'master' ELSE 'operator' END")

    # org_id nos recursos escopados
    for table in ("device", "device_group", "credential"):
        op.add_column(table, sa.Column("org_id", sa.Integer(), nullable=True))
        op.create_foreign_key(f"fk_{table}_org", table, "organization", ["org_id"], ["id"], ondelete="CASCADE")
        op.create_index(f"ix_{table}_org_id", table, ["org_id"], unique=False)

    # nomes deixam de ser globalmente únicos (passam a ser por ORG)
    op.execute("ALTER TABLE device_group DROP CONSTRAINT IF EXISTS device_group_name_key")
    op.execute("ALTER TABLE credential DROP CONSTRAINT IF EXISTS credential_name_key")


def downgrade() -> None:
    for table in ("device", "device_group", "credential"):
        op.drop_index(f"ix_{table}_org_id", table_name=table)
        op.drop_constraint(f"fk_{table}_org", table, type_="foreignkey")
        op.drop_column(table, "org_id")
    op.drop_index(op.f("ix_user_org_id"), table_name="user")
    op.drop_constraint("fk_user_org", "user", type_="foreignkey")
    op.drop_column("user", "org_id")
    op.drop_column("user", "role")
    op.drop_table("organization")
    op.drop_table("plan")
