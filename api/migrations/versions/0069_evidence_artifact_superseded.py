"""Add superseded_by to evidence_artifacts.

Revision ID: 0069
Revises: 0068
Create Date: 2026-06-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0069"
down_revision = "0068"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "evidence_artifacts",
        sa.Column(
            "superseded_by",
            UUID(as_uuid=True),
            sa.ForeignKey("evidence_artifacts.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_evidence_artifacts_superseded_by", "evidence_artifacts", ["superseded_by"])


def downgrade() -> None:
    op.drop_index("ix_evidence_artifacts_superseded_by", table_name="evidence_artifacts")
    op.drop_column("evidence_artifacts", "superseded_by")
