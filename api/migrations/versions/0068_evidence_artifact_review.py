"""Add review and integrity fields to evidence_artifacts.

Revision ID: 0068
Revises: 0067
Create Date: 2026-06-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0068"
down_revision = "0067"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("evidence_artifacts", sa.Column("checksum_sha256", sa.String(length=64), nullable=True))
    op.add_column("evidence_artifacts", sa.Column("review_notes", sa.Text(), nullable=True))
    op.add_column(
        "evidence_artifacts",
        sa.Column("reviewed_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column("evidence_artifacts", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("evidence_artifacts", "reviewed_at")
    op.drop_column("evidence_artifacts", "reviewed_by")
    op.drop_column("evidence_artifacts", "review_notes")
    op.drop_column("evidence_artifacts", "checksum_sha256")
