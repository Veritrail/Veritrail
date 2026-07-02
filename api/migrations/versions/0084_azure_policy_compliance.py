"""Azure Policy compliance collector.

Revision ID: 0084
Revises: 0083
Create Date: 2026-07-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0084"
down_revision = "0083"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "azure_policy_compliance",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "azure_subscription_id",
            UUID(as_uuid=True),
            sa.ForeignKey("azure_subscriptions.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("policy_insights_enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("non_compliant_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "azure_policy_non_compliance",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "azure_subscription_id",
            UUID(as_uuid=True),
            sa.ForeignKey("azure_subscriptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("policy_state_id", sa.String(length=500), nullable=False),
        sa.Column("policy_definition_name", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("policy_assignment_name", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("resource_id", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("resource_type", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("compliance_state", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "azure_subscription_id",
            "policy_state_id",
            name="uq_azure_policy_subscription_state",
        ),
    )
    op.create_index(
        "ix_azure_policy_non_compliance_azure_subscription_id",
        "azure_policy_non_compliance",
        ["azure_subscription_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_azure_policy_non_compliance_azure_subscription_id",
        table_name="azure_policy_non_compliance",
    )
    op.drop_table("azure_policy_non_compliance")
    op.drop_table("azure_policy_compliance")
