"""Add display_name to users.

Revision ID: 0089
Revises: 0088
Create Date: 2026-07-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0089"
down_revision = "0088"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("display_name", sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "display_name")
