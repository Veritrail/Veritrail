"""GCP phase-one baseline collectors tables.

Revision ID: 0071
Revises: 0070
Create Date: 2026-06-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0071"
down_revision = "0070"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gcp_projects",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.String(length=120), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("service_account_json", sa.String(length=8000), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="pending"),
        sa.Column("last_scan_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("org_id", "project_id", name="uq_gcp_projects_org_project"),
    )
    op.create_index("ix_gcp_projects_org_id", "gcp_projects", ["org_id"])

    op.create_table(
        "gcp_compute_instances",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "gcp_project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("gcp_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("instance_id", sa.String(length=200), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("zone", sa.String(length=80), nullable=False),
        sa.Column("has_public_ip", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", sa.String(length=40), nullable=True),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("gcp_project_id", "instance_id", name="uq_gcp_compute_project_instance"),
    )
    op.create_index("ix_gcp_compute_instances_gcp_project_id", "gcp_compute_instances", ["gcp_project_id"])

    op.create_table(
        "gcp_logging_audit",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "gcp_project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("gcp_projects.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("audit_logging_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sink_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("gcp_logging_audit")
    op.drop_index("ix_gcp_compute_instances_gcp_project_id", table_name="gcp_compute_instances")
    op.drop_table("gcp_compute_instances")
    op.drop_index("ix_gcp_projects_org_id", table_name="gcp_projects")
    op.drop_table("gcp_projects")
