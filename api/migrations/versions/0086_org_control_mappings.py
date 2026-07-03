"""Per-org control mapping overrides (Phase 7).

Revision ID: 0086
Revises: 0085
Create Date: 2026-07-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0086"
down_revision = "0085"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "org_control_mappings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("framework", sa.String(length=40), nullable=False),
        sa.Column("control_id", sa.String(length=30), nullable=False),
        sa.Column("added_check_ids", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("removed_check_ids", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("org_id", "framework", "control_id"),
    )
    op.create_index("ix_org_control_mappings_org_id", "org_control_mappings", ["org_id"])
    op.create_index("ix_org_control_mappings_framework", "org_control_mappings", ["framework"])
    op.create_index("ix_org_control_mappings_control_id", "org_control_mappings", ["control_id"])


def downgrade() -> None:
    op.drop_table("org_control_mappings")
