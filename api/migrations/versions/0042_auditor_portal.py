"""Add auditor_accesses, audit_activity_logs, and trust_center_configs tables."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0042_auditor_portal"
down_revision = "0041_ai_triage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # AuditorAccess
    op.create_table(
        "auditor_accesses",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("name", sa.String(200), nullable=True),
        sa.Column("access_token", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_accessed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], name="auditor_accesses_org_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], name="auditor_accesses_created_by_fkey", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_auditor_accesses_org_id"), "auditor_accesses", ["org_id"])
    op.create_index(op.f("ix_auditor_accesses_access_token"), "auditor_accesses", ["access_token"], unique=True)

    # AuditActivityLog
    op.create_table(
        "audit_activity_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("auditor_access_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("resource_type", sa.String(60), nullable=False),
        sa.Column("resource_id", sa.String(200), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["auditor_access_id"],
            ["auditor_accesses.id"],
            name="audit_activity_logs_auditor_access_id_fkey",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_audit_activity_logs_auditor_access_id"), "audit_activity_logs", ["auditor_access_id"])

    # TrustCenterConfig
    op.create_table(
        "trust_center_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("subdomain_slug", sa.String(100), nullable=False),
        sa.Column("company_name", sa.String(300), nullable=False),
        sa.Column("company_logo_url", sa.String(1024), nullable=True),
        sa.Column("frameworks_to_show", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("custom_message", sa.Text(), nullable=True),
        sa.Column("last_updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], name="trust_center_configs_org_id_fkey", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id"),
    )
    op.create_index(op.f("ix_trust_center_configs_org_id"), "trust_center_configs", ["org_id"])
    op.create_index(op.f("ix_trust_center_configs_subdomain_slug"), "trust_center_configs", ["subdomain_slug"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_trust_center_configs_subdomain_slug"), table_name="trust_center_configs")
    op.drop_index(op.f("ix_trust_center_configs_org_id"), table_name="trust_center_configs")
    op.drop_table("trust_center_configs")
    op.drop_index(op.f("ix_audit_activity_logs_auditor_access_id"), table_name="audit_activity_logs")
    op.drop_table("audit_activity_logs")
    op.drop_index(op.f("ix_auditor_accesses_access_token"), table_name="auditor_accesses")
    op.drop_index(op.f("ix_auditor_accesses_org_id"), table_name="auditor_accesses")
    op.drop_table("auditor_accesses")
