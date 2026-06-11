"""Add iam_instance_profile_arn to ec2_instances (CIS 1.17 check)."""
import sqlalchemy as sa
from alembic import op

revision = "0055"
down_revision = "0054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ec2_instances",
        sa.Column("iam_instance_profile_arn", sa.String(length=512), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ec2_instances", "iam_instance_profile_arn")
