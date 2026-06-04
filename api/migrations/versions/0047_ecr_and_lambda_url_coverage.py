"""ECR repositories and Lambda function URL coverage.

Revision ID: 0047
Revises: 0046_user_mfa_backup_codes
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0047"
down_revision = "0046_user_mfa_backup_codes"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("lambda_functions", sa.Column("function_url", sa.String(1024), nullable=True))
    op.add_column("lambda_functions", sa.Column("function_url_auth_type", sa.String(32), nullable=True))

    op.create_table(
        "ecr_repositories",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("aws_accounts.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("region", sa.String(40), nullable=False),
        sa.Column("repository_name", sa.String(256), nullable=False),
        sa.Column("repository_arn", sa.String(512), nullable=False),
        sa.Column("scan_on_push", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("encryption_type", sa.String(32), nullable=True),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("account_id", "repository_arn"),
    )


def downgrade():
    op.drop_table("ecr_repositories")
    op.drop_column("lambda_functions", "function_url_auth_type")
    op.drop_column("lambda_functions", "function_url")
