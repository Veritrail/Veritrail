"""Capability coverage snapshots + native cloud evidence depth columns.

Revision ID: 0100
Revises: 0099
Create Date: 2026-07-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0100"
down_revision = "0099"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "capability_coverage_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "org_id",
            UUID(as_uuid=True),
            sa.ForeignKey("orgs.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("payload_json", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "taken_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
            index=True,
        ),
    )

    op.add_column(
        "inspector_account_status",
        sa.Column("lambda_code_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "inspector_account_status",
        sa.Column("code_repository_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "inspector_account_status",
        sa.Column("evidence_json", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )

    op.add_column(
        "gcp_osconfig_vuln",
        sa.Column("evidence_json", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column(
        "gcp_security_command_center",
        sa.Column("evidence_json", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column(
        "azure_defender_status",
        sa.Column("evidence_json", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )


def downgrade() -> None:
    op.drop_column("azure_defender_status", "evidence_json")
    op.drop_column("gcp_security_command_center", "evidence_json")
    op.drop_column("gcp_osconfig_vuln", "evidence_json")
    op.drop_column("inspector_account_status", "evidence_json")
    op.drop_column("inspector_account_status", "code_repository_enabled")
    op.drop_column("inspector_account_status", "lambda_code_enabled")
    op.drop_index("ix_capability_coverage_snapshots_taken_at", table_name="capability_coverage_snapshots")
    op.drop_index("ix_capability_coverage_snapshots_org_id", table_name="capability_coverage_snapshots")
    op.drop_table("capability_coverage_snapshots")
