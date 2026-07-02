"""Azure Activity Log / diagnostic settings collector baseline.

Revision ID: 0082
Revises: 0081
Create Date: 2026-07-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0082"
down_revision = "0081"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "azure_activity_log_settings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "azure_subscription_id",
            UUID(as_uuid=True),
            sa.ForeignKey("azure_subscriptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("activity_log_export_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("diagnostic_settings_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "azure_subscription_id",
            name="uq_azure_activity_log_subscription",
        ),
    )
    op.create_index(
        "ix_azure_activity_log_settings_azure_subscription_id",
        "azure_activity_log_settings",
        ["azure_subscription_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_azure_activity_log_settings_azure_subscription_id",
        table_name="azure_activity_log_settings",
    )
    op.drop_table("azure_activity_log_settings")
