"""Identity Center user external timestamps for stale-user checks.

Revision ID: 0052
Revises: 0051
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "identity_center_users",
        sa.Column("external_created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "identity_center_users",
        sa.Column("external_updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("identity_center_users", "external_updated_at")
    op.drop_column("identity_center_users", "external_created_at")
