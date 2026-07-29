"""charge (cobranças do hub — reconciliação de pagamento)

Revision ID: c3e5a7b9d1f4
Revises: a8b9c0d1e2f3
Create Date: 2026-07-29 12:00:00.000000
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "c3e5a7b9d1f4"
down_revision: str | None = "a8b9c0d1e2f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "charge",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("hub_charge_id", sa.String(length=64), nullable=False),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organization.id", ondelete="CASCADE"), nullable=True),
        sa.Column("plan_id", sa.Integer(), sa.ForeignKey("plan.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="pending"),
        sa.Column("amount_cents", sa.Integer(), nullable=True),
        sa.Column("external_reference", sa.String(length=120), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_charge_hub_charge_id", "charge", ["hub_charge_id"], unique=True)
    op.create_index("ix_charge_org_id", "charge", ["org_id"])
    op.create_index("ix_charge_status", "charge", ["status"])


def downgrade() -> None:
    op.drop_index("ix_charge_status", table_name="charge")
    op.drop_index("ix_charge_org_id", table_name="charge")
    op.drop_index("ix_charge_hub_charge_id", table_name="charge")
    op.drop_table("charge")
