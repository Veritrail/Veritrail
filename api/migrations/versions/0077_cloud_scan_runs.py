"""Cloud scan runs for GCP/Azure progress tracking.

Revision ID: 0077
Revises: 0076
Create Date: 2026-06-26
"""
import sqlalchemy as sa
from alembic import op

revision = "0077"
down_revision = "0076"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cloud_scan_runs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("resource_id", sa.UUID(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="running"),
        sa.Column("stats", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("error", sa.String(length=2000), nullable=True),
        sa.Column("findings_opened", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("findings_resolved", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cloud_scan_runs_org_id", "cloud_scan_runs", ["org_id"])
    op.create_index("ix_cloud_scan_runs_provider", "cloud_scan_runs", ["provider"])
    op.create_index("ix_cloud_scan_runs_resource_id", "cloud_scan_runs", ["resource_id"])
    op.create_index(
        "ix_cloud_scan_runs_provider_resource_started",
        "cloud_scan_runs",
        ["provider", "resource_id", "started_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_cloud_scan_runs_provider_resource_started", table_name="cloud_scan_runs")
    op.drop_index("ix_cloud_scan_runs_resource_id", table_name="cloud_scan_runs")
    op.drop_index("ix_cloud_scan_runs_provider", table_name="cloud_scan_runs")
    op.drop_index("ix_cloud_scan_runs_org_id", table_name="cloud_scan_runs")
    op.drop_table("cloud_scan_runs")
