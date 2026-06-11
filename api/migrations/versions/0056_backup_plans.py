"""AWS Backup plans table."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0056"
down_revision = "0055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "backup_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("region", sa.String(length=40), nullable=False),
        sa.Column("plan_id", sa.String(length=64), nullable=False),
        sa.Column("plan_arn", sa.String(length=512), nullable=False),
        sa.Column("plan_name", sa.String(length=256), nullable=True),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["aws_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "region", "plan_id"),
    )
    op.create_index("ix_backup_plans_account_id", "backup_plans", ["account_id"])


def downgrade() -> None:
    op.drop_index("ix_backup_plans_account_id", table_name="backup_plans")
    op.drop_table("backup_plans")
