"""Phase 8.5: GCP firewall rules, CAI public IAM roles, session auth_method.

Revision ID: 0087
Revises: 0086
Create Date: 2026-07-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0087"
down_revision = "0086"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gcp_firewall_rules",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "gcp_project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("gcp_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("rule_id", sa.String(length=200), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("network", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("target_tags", JSONB, nullable=True),
        sa.Column("allows_world_ingress", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("gcp_project_id", "rule_id", name="uq_gcp_firewall_project_rule"),
    )
    op.create_index("ix_gcp_firewall_rules_gcp_project_id", "gcp_firewall_rules", ["gcp_project_id"])

    op.add_column("gcp_compute_instances", sa.Column("network", sa.String(length=500), nullable=True))
    op.add_column("gcp_compute_instances", sa.Column("tags", JSONB, nullable=True))

    op.add_column("gcp_cloud_assets", sa.Column("public_iam_roles", JSONB, nullable=True))

    op.add_column(
        "user_sessions",
        sa.Column("auth_method", sa.String(length=40), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user_sessions", "auth_method")
    op.drop_column("gcp_cloud_assets", "public_iam_roles")
    op.drop_column("gcp_compute_instances", "tags")
    op.drop_column("gcp_compute_instances", "network")
    op.drop_index("ix_gcp_firewall_rules_gcp_project_id", table_name="gcp_firewall_rules")
    op.drop_table("gcp_firewall_rules")
