"""Add evidence_artifacts for uploaded control evidence.

Revision ID: 0066
Revises: 0065
Create Date: 2026-06-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0066"
down_revision = "0065"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "evidence_artifacts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("control_id", UUID(as_uuid=True), sa.ForeignKey("controls.id", ondelete="SET NULL"), nullable=True),
        sa.Column("framework", sa.String(length=40), nullable=False),
        sa.Column("control_ref", sa.String(length=40), nullable=True),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("source", sa.String(length=120), nullable=True),
        sa.Column("evidence_type", sa.String(length=80), nullable=True),
        sa.Column("period_start", sa.Date(), nullable=True),
        sa.Column("period_end", sa.Date(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("filename", sa.String(length=300), nullable=False),
        sa.Column("storage_path", sa.String(length=700), nullable=False),
        sa.Column("content_type", sa.String(length=160), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column("suggested_mappings", JSONB(), nullable=False, server_default="[]"),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_evidence_artifacts_org_id", "evidence_artifacts", ["org_id"])
    op.create_index("ix_evidence_artifacts_control_id", "evidence_artifacts", ["control_id"])
    op.create_index("ix_evidence_artifacts_framework", "evidence_artifacts", ["framework"])


def downgrade() -> None:
    op.drop_index("ix_evidence_artifacts_framework", table_name="evidence_artifacts")
    op.drop_index("ix_evidence_artifacts_control_id", table_name="evidence_artifacts")
    op.drop_index("ix_evidence_artifacts_org_id", table_name="evidence_artifacts")
    op.drop_table("evidence_artifacts")
