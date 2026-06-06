"""Add security_features JSONB to repos for GitHub security metadata.

Revision ID: 0051
Revises: 0050
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("repos", sa.Column("security_features", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("repos", "security_features")
