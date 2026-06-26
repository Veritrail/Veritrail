"""Add policy_ref to evidence_artifacts.

Revision ID: 0074
Revises: 0073
Create Date: 2026-06-26
"""
from alembic import op
import sqlalchemy as sa

revision = "0074"
down_revision = "0073"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("evidence_artifacts", sa.Column("policy_ref", sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column("evidence_artifacts", "policy_ref")
