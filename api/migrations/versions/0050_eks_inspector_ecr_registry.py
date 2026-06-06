"""EKS logging/encryption, ECR registry scanning, Inspector v2 coverage.

Revision ID: 0050
Revises: 0049
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "eks_clusters",
        sa.Column("control_plane_logging_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "eks_clusters",
        sa.Column("secrets_encryption_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )

    op.create_table(
        "ecr_registry_settings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("aws_accounts.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("region", sa.String(40), nullable=False),
        sa.Column("scan_type", sa.String(32), nullable=True),
        sa.Column("enhanced_scanning_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("account_id", "region"),
    )

    op.create_table(
        "inspector_account_status",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("aws_accounts.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("region", sa.String(40), nullable=False),
        sa.Column("ecr_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("ec2_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("lambda_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("account_id", "region"),
    )

    op.create_table(
        "inspector_findings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("aws_accounts.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("region", sa.String(40), nullable=False),
        sa.Column("finding_arn", sa.String(512), nullable=False),
        sa.Column("resource_type", sa.String(64), nullable=True),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("title", sa.String(512), nullable=True),
        sa.Column("resource_id", sa.String(512), nullable=True),
        sa.Column("fix_available", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("account_id", "finding_arn"),
    )


def downgrade():
    op.drop_table("inspector_findings")
    op.drop_table("inspector_account_status")
    op.drop_table("ecr_registry_settings")
    op.drop_column("eks_clusters", "secrets_encryption_enabled")
    op.drop_column("eks_clusters", "control_plane_logging_enabled")
