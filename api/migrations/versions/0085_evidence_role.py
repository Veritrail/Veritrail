"""Granular evidence_role on org memberships.

Revision ID: 0085
Revises: 0084
Create Date: 2026-07-03
"""
from alembic import op
import sqlalchemy as sa

revision = "0085"
down_revision = "0084"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "org_memberships",
        sa.Column("evidence_role", sa.String(length=40), nullable=False, server_default="contributor"),
    )
    op.execute(
        "UPDATE org_memberships SET evidence_role = 'reviewer' WHERE role IN ('owner', 'admin')"
    )
    op.execute(
        "UPDATE org_memberships SET evidence_role = 'contributor' WHERE role = 'editor'"
    )
    op.execute(
        "UPDATE org_memberships SET evidence_role = 'auditor-viewer' WHERE role = 'viewer'"
    )


def downgrade() -> None:
    op.drop_column("org_memberships", "evidence_role")
