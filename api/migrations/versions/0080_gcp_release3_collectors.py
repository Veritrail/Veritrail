"""GCP Release 3 collectors: OS Config vuln, SCC, Cloud Asset Inventory.

Revision ID: 0080
Revises: 0079
Create Date: 2026-07-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0080"
down_revision = "0079"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gcp_osconfig_vuln",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "gcp_project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("gcp_projects.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("api_accessible", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("report_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("has_reports", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "gcp_security_command_center",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "gcp_project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("gcp_projects.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("scc_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("active_finding_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("high_severity_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "gcp_cloud_assets",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "gcp_project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("gcp_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("asset_name", sa.String(length=500), nullable=False),
        sa.Column("asset_type", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("has_public_iam", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("gcp_project_id", "asset_name", name="uq_gcp_cloud_assets_project_asset"),
    )
    op.create_index("ix_gcp_cloud_assets_gcp_project_id", "gcp_cloud_assets", ["gcp_project_id"])


def downgrade() -> None:
    op.drop_index("ix_gcp_cloud_assets_gcp_project_id", table_name="gcp_cloud_assets")
    op.drop_table("gcp_cloud_assets")
    op.drop_table("gcp_security_command_center")
    op.drop_table("gcp_osconfig_vuln")
