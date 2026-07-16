"""racks: rack, rack_link, device.rack_id

Revision ID: e9f0a1b2c3d4
Revises: d8e9f0a1b2c3
Create Date: 2026-07-13 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e9f0a1b2c3d4"
down_revision: Union[str, None] = "d8e9f0a1b2c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rack",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=True),
        sa.Column("site_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["site_id"], ["device_group.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_rack_org_id"), "rack", ["org_id"], unique=False)
    op.create_index(op.f("ix_rack_site_id"), "rack", ["site_id"], unique=False)

    op.create_table(
        "rack_link",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=True),
        sa.Column("rack_a_id", sa.Integer(), nullable=False),
        sa.Column("rack_b_id", sa.Integer(), nullable=False),
        sa.Column("iface_a", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("iface_b", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["organization.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["rack_a_id"], ["rack.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["rack_b_id"], ["rack.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_rack_link_org_id"), "rack_link", ["org_id"], unique=False)

    op.add_column("device", sa.Column("rack_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_device_rack", "device", "rack", ["rack_id"], ["id"], ondelete="SET NULL")
    op.create_index(op.f("ix_device_rack_id"), "device", ["rack_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_device_rack_id"), table_name="device")
    op.drop_constraint("fk_device_rack", "device", type_="foreignkey")
    op.drop_column("device", "rack_id")
    op.drop_index(op.f("ix_rack_link_org_id"), table_name="rack_link")
    op.drop_table("rack_link")
    op.drop_index(op.f("ix_rack_site_id"), table_name="rack")
    op.drop_index(op.f("ix_rack_org_id"), table_name="rack")
    op.drop_table("rack")
