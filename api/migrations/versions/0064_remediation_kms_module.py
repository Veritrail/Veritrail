"""Add KMS key-rotation remediation module columns to aws_accounts.

Revision ID: 0064
Revises: 0063
Create Date: 2026-06-20
"""
from alembic import op
import sqlalchemy as sa

revision = "0064"
down_revision = "0063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "aws_accounts",
        sa.Column(
            "enable_remediation_kms",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "aws_accounts",
        sa.Column(
            "remediation_kms_deployed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("aws_accounts", "remediation_kms_deployed")
    op.drop_column("aws_accounts", "enable_remediation_kms")
