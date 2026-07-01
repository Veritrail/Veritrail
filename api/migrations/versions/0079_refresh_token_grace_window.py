"""Add previous-token grace window to user_sessions for refresh races.

Revision ID: 0079
Revises: 0078
Create Date: 2026-07-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0079"
down_revision = "0078"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_sessions", sa.Column("prev_token_hash", sa.String(length=64), nullable=True))
    op.add_column("user_sessions", sa.Column("prev_token_rotated_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_user_sessions_prev_token_hash", "user_sessions", ["prev_token_hash"])


def downgrade() -> None:
    op.drop_index("ix_user_sessions_prev_token_hash", table_name="user_sessions")
    op.drop_column("user_sessions", "prev_token_rotated_at")
    op.drop_column("user_sessions", "prev_token_hash")
