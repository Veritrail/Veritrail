"""Add pending ExternalId rotation columns on aws_accounts.

Revision ID: 0094
Revises: 0093
Create Date: 2026-07-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0094"
down_revision = "0093"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "aws_accounts",
        sa.Column("pending_external_id", sa.String(200), nullable=True),
    )
    op.add_column(
        "aws_accounts",
        sa.Column("external_id_rotation_requested_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("aws_accounts", "external_id_rotation_requested_at")
    op.drop_column("aws_accounts", "pending_external_id")
