"""Evidence sources ORM table and evidence artifact comments.

Revision ID: 0070
Revises: 0069
Create Date: 2026-06-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0070"
down_revision = "0069"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "evidence_sources",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category_key", sa.String(length=80), nullable=False),
        sa.Column("vendor", sa.String(length=120), nullable=False),
        sa.Column("owner", sa.String(length=200), nullable=True),
        sa.Column("cadence", sa.String(length=80), nullable=True),
        sa.Column("scope_description", sa.Text(), nullable=True),
        sa.Column("source_type", sa.String(length=80), nullable=True),
        sa.Column("updated_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("org_id", "category_key", name="uq_evidence_sources_org_category"),
    )
    op.create_index("ix_evidence_sources_org_id", "evidence_sources", ["org_id"])

    op.create_table(
        "evidence_artifact_comments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "artifact_id",
            UUID(as_uuid=True),
            sa.ForeignKey("evidence_artifacts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_evidence_artifact_comments_org_id", "evidence_artifact_comments", ["org_id"])
    op.create_index("ix_evidence_artifact_comments_artifact_id", "evidence_artifact_comments", ["artifact_id"])


def downgrade() -> None:
    op.drop_index("ix_evidence_artifact_comments_artifact_id", table_name="evidence_artifact_comments")
    op.drop_index("ix_evidence_artifact_comments_org_id", table_name="evidence_artifact_comments")
    op.drop_table("evidence_artifact_comments")
    op.drop_index("ix_evidence_sources_org_id", table_name="evidence_sources")
    op.drop_table("evidence_sources")
