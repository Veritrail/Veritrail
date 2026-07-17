"""Drop advanced IAM policy generation columns (Access Analyzer feature retired).

The connector is read-only; advanced (CloudTrail / Access Analyzer) policy generation
was removed. Drop the two flags that gated it.
"""

from alembic import op
import sqlalchemy as sa

revision = "0099"
down_revision = "0098"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("aws_accounts", "advanced_policy_generation_deployed")
    op.drop_column("aws_accounts", "enable_advanced_policy_generation")


def downgrade() -> None:
    op.add_column(
        "aws_accounts",
        sa.Column(
            "enable_advanced_policy_generation",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "aws_accounts",
        sa.Column(
            "advanced_policy_generation_deployed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
