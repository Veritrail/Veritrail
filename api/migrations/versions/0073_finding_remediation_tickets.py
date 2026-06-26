"""Finding remediation ticket columns and multi-cloud scope FKs.

Revision ID: 0073
Revises: 0072
Create Date: 2026-06-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0073"
down_revision = "0072"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("findings", sa.Column("remediation_ticket_key", sa.String(length=80), nullable=True))
    op.add_column("findings", sa.Column("remediation_ticket_url", sa.String(length=500), nullable=True))
    op.add_column(
        "findings",
        sa.Column(
            "gcp_project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("gcp_projects.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "findings",
        sa.Column(
            "azure_subscription_id",
            UUID(as_uuid=True),
            sa.ForeignKey("azure_subscriptions.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_findings_gcp_project_id", "findings", ["gcp_project_id"])
    op.create_index("ix_findings_azure_subscription_id", "findings", ["azure_subscription_id"])

    op.drop_constraint("findings_account_id_check_id_resource_arn_key", "findings", type_="unique")
    op.alter_column("findings", "account_id", existing_type=UUID(as_uuid=True), nullable=True)

    op.create_index(
        "uq_findings_account_check_resource",
        "findings",
        ["account_id", "check_id", "resource_arn"],
        unique=True,
        postgresql_where=sa.text("account_id IS NOT NULL"),
    )
    op.create_index(
        "uq_findings_gcp_check_resource",
        "findings",
        ["gcp_project_id", "check_id", "resource_arn"],
        unique=True,
        postgresql_where=sa.text("gcp_project_id IS NOT NULL"),
    )
    op.create_index(
        "uq_findings_azure_check_resource",
        "findings",
        ["azure_subscription_id", "check_id", "resource_arn"],
        unique=True,
        postgresql_where=sa.text("azure_subscription_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_findings_azure_check_resource", table_name="findings")
    op.drop_index("uq_findings_gcp_check_resource", table_name="findings")
    op.drop_index("uq_findings_account_check_resource", table_name="findings")
    op.alter_column("findings", "account_id", existing_type=UUID(as_uuid=True), nullable=False)
    op.create_unique_constraint(
        "findings_account_id_check_id_resource_arn_key",
        "findings",
        ["account_id", "check_id", "resource_arn"],
    )
    op.drop_index("ix_findings_azure_subscription_id", table_name="findings")
    op.drop_index("ix_findings_gcp_project_id", table_name="findings")
    op.drop_column("findings", "azure_subscription_id")
    op.drop_column("findings", "gcp_project_id")
    op.drop_column("findings", "remediation_ticket_url")
    op.drop_column("findings", "remediation_ticket_key")
