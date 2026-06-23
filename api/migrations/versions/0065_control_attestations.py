"""Add control_attestations (org-level manual control sign-off).

Revision ID: 0065
Revises: 0064
Create Date: 2026-06-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0065"
down_revision = "0064"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "control_attestations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("control_id", UUID(as_uuid=True), sa.ForeignKey("controls.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("owner", sa.String(length=200), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("evidence_filename", sa.String(length=300), nullable=True),
        sa.Column("evidence_path", sa.String(length=500), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("org_id", "control_id", name="uq_control_attestation_org_control"),
    )
    op.create_index("ix_control_attestations_org_id", "control_attestations", ["org_id"])
    op.create_index("ix_control_attestations_control_id", "control_attestations", ["control_id"])


def downgrade() -> None:
    op.drop_index("ix_control_attestations_control_id", table_name="control_attestations")
    op.drop_index("ix_control_attestations_org_id", table_name="control_attestations")
    op.drop_table("control_attestations")
