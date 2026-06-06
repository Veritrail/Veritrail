"""Add CloudTrail onboarding preference per AWS account."""
from alembic import op
import sqlalchemy as sa

revision = "0053"
down_revision = "0052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "aws_accounts",
        sa.Column("cloudtrail_onboarding_mode", sa.String(32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("aws_accounts", "cloudtrail_onboarding_mode")
