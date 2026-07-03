"""Phase 9 deferred P4: vault shares, org frameworks, coverage tables, MDM devices.

Revision ID: 0088
Revises: 0087
Create Date: 2026-07-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0088"
down_revision = "0087"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vault_export_shares",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "export_id",
            UUID(as_uuid=True),
            sa.ForeignKey("evidence_exports.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "auditor_access_id",
            UUID(as_uuid=True),
            sa.ForeignKey("auditor_accesses.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "approved_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("link_type", sa.String(length=40), nullable=False),
        sa.Column("share_url", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_vault_export_shares_org_id", "vault_export_shares", ["org_id"])
    op.create_index("ix_vault_export_shares_export_id", "vault_export_shares", ["export_id"])

    op.create_table(
        "org_frameworks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("slug", sa.String(length=40), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("control_definitions", JSONB, nullable=False, server_default="[]"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("org_id", "slug", name="uq_org_frameworks_org_slug"),
    )
    op.create_index("ix_org_frameworks_org_id", "org_frameworks", ["org_id"])

    op.create_table(
        "evidence_requirements",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("framework", sa.String(length=40), nullable=False),
        sa.Column("composite_control_id", sa.String(length=80), nullable=False),
        sa.Column("requirement_key", sa.String(length=80), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("category_key", sa.String(length=40), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "org_id",
            "framework",
            "composite_control_id",
            "requirement_key",
            name="uq_evidence_requirements_org_fw_composite_key",
        ),
    )
    op.create_index("ix_evidence_requirements_org_id", "evidence_requirements", ["org_id"])

    op.create_table(
        "control_coverages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "account_id",
            UUID(as_uuid=True),
            sa.ForeignKey("aws_accounts.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("framework", sa.String(length=40), nullable=False),
        sa.Column("control_id", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("coverage_source", sa.String(length=40), nullable=False),
        sa.Column("details", JSONB, nullable=False, server_default="{}"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "org_id",
            "account_id",
            "framework",
            "control_id",
            name="uq_control_coverages_org_account_fw_control",
        ),
    )
    op.create_index("ix_control_coverages_org_id", "control_coverages", ["org_id"])

    op.create_table(
        "mdm_device_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "provider_id",
            UUID(as_uuid=True),
            sa.ForeignKey("identity_providers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("external_id", sa.String(length=120), nullable=False),
        sa.Column("device_name", sa.String(length=320), nullable=True),
        sa.Column("platform", sa.String(length=40), nullable=True),
        sa.Column("encrypted", sa.Boolean(), nullable=True),
        sa.Column("compliant", sa.Boolean(), nullable=True),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("provider_id", "external_id", name="uq_mdm_device_provider_external"),
    )
    op.create_index("ix_mdm_device_snapshots_provider_id", "mdm_device_snapshots", ["provider_id"])


def downgrade() -> None:
    op.drop_table("mdm_device_snapshots")
    op.drop_table("control_coverages")
    op.drop_table("evidence_requirements")
    op.drop_table("org_frameworks")
    op.drop_table("vault_export_shares")
