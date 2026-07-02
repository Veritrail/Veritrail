"""Azure Resource Graph collector: compute VM inventory baseline.

Revision ID: 0081
Revises: 0080
Create Date: 2026-07-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0081"
down_revision = "0080"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "azure_compute_instances",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "azure_subscription_id",
            UUID(as_uuid=True),
            sa.ForeignKey("azure_subscriptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("vm_id", sa.String(length=500), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("resource_group", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("location", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("has_public_ip", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "azure_subscription_id",
            "vm_id",
            name="uq_azure_compute_subscription_vm",
        ),
    )
    op.create_index(
        "ix_azure_compute_instances_azure_subscription_id",
        "azure_compute_instances",
        ["azure_subscription_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_azure_compute_instances_azure_subscription_id",
        table_name="azure_compute_instances",
    )
    op.drop_table("azure_compute_instances")
