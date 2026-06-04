"""RDS snapshot and EKS cluster coverage.

Revision ID: 0048
Revises: 0047
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON, UUID


revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "rds_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("aws_accounts.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("region", sa.String(40), nullable=False),
        sa.Column("snapshot_id", sa.String(256), nullable=False),
        sa.Column("arn", sa.String(512), nullable=False),
        sa.Column("engine", sa.String(64), nullable=True),
        sa.Column("encrypted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_public", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("account_id", "region", "snapshot_id"),
    )
    op.create_table(
        "eks_clusters",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("aws_accounts.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("region", sa.String(40), nullable=False),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("arn", sa.String(512), nullable=False),
        sa.Column("endpoint_public_access", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("endpoint_private_access", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("public_access_cidrs", JSON(), nullable=True),
        sa.Column("version", sa.String(32), nullable=True),
        sa.Column("status", sa.String(64), nullable=True),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("account_id", "arn"),
    )


def downgrade():
    op.drop_table("eks_clusters")
    op.drop_table("rds_snapshots")
