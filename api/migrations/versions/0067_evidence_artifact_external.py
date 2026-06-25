"""Extend evidence_artifacts for composite-group external evidence.

Revision ID: 0067
Revises: 0066
Create Date: 2026-06-25
"""
from alembic import op
import sqlalchemy as sa

revision = "0067"
down_revision = "0066"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("evidence_artifacts", sa.Column("composite_control_id", sa.String(length=80), nullable=True))
    op.add_column("evidence_artifacts", sa.Column("check_id", sa.String(length=120), nullable=True))
    op.add_column("evidence_artifacts", sa.Column("external_url", sa.String(length=500), nullable=True))
    op.add_column("evidence_artifacts", sa.Column("owner", sa.String(length=200), nullable=True))
    op.add_column(
        "evidence_artifacts",
        sa.Column("status", sa.String(length=20), nullable=False, server_default="submitted"),
    )
    op.add_column("evidence_artifacts", sa.Column("expires_at", sa.Date(), nullable=True))
    op.alter_column("evidence_artifacts", "filename", existing_type=sa.String(length=300), nullable=True)
    op.alter_column("evidence_artifacts", "storage_path", existing_type=sa.String(length=700), nullable=True)
    op.create_index(
        "ix_evidence_artifacts_composite_control_id",
        "evidence_artifacts",
        ["composite_control_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_evidence_artifacts_composite_control_id", table_name="evidence_artifacts")
    op.alter_column("evidence_artifacts", "storage_path", existing_type=sa.String(length=700), nullable=False)
    op.alter_column("evidence_artifacts", "filename", existing_type=sa.String(length=300), nullable=False)
    op.drop_column("evidence_artifacts", "expires_at")
    op.drop_column("evidence_artifacts", "status")
    op.drop_column("evidence_artifacts", "owner")
    op.drop_column("evidence_artifacts", "external_url")
    op.drop_column("evidence_artifacts", "check_id")
    op.drop_column("evidence_artifacts", "composite_control_id")
