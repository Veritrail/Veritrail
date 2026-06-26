"""Azure phase-one baseline collectors tables.

Revision ID: 0072
Revises: 0071
Create Date: 2026-06-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0072"
down_revision = "0071"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "azure_subscriptions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("subscription_id", sa.String(length=80), nullable=False),
        sa.Column("tenant_id", sa.String(length=80), nullable=False),
        sa.Column("client_id", sa.String(length=80), nullable=False),
        sa.Column("client_secret", sa.String(length=2000), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="pending"),
        sa.Column("last_scan_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("org_id", "subscription_id", name="uq_azure_subscriptions_org_subscription"),
    )
    op.create_index("ix_azure_subscriptions_org_id", "azure_subscriptions", ["org_id"])

    op.create_table(
        "azure_defender_status",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "azure_subscription_id",
            UUID(as_uuid=True),
            sa.ForeignKey("azure_subscriptions.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("secure_score", sa.Float(), nullable=True),
        sa.Column("pricing_tier", sa.String(length=40), nullable=True),
        sa.Column("defender_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "azure_storage_accounts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "azure_subscription_id",
            UUID(as_uuid=True),
            sa.ForeignKey("azure_subscriptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("account_name", sa.String(length=120), nullable=False),
        sa.Column("resource_group", sa.String(length=120), nullable=False),
        sa.Column("public_blob_access", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "azure_subscription_id",
            "account_name",
            name="uq_azure_storage_subscription_account",
        ),
    )
    op.create_index(
        "ix_azure_storage_accounts_azure_subscription_id",
        "azure_storage_accounts",
        ["azure_subscription_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_azure_storage_accounts_azure_subscription_id", table_name="azure_storage_accounts")
    op.drop_table("azure_storage_accounts")
    op.drop_table("azure_defender_status")
    op.drop_index("ix_azure_subscriptions_org_id", table_name="azure_subscriptions")
    op.drop_table("azure_subscriptions")
