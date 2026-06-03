"""Add is_organization_trail and management_account_id to cloudtrail_trails."""

from alembic import op
import sqlalchemy as sa

revision = "0044_org_trail_columns"
down_revision = "0043_drift_alerts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cloudtrail_trails",
        sa.Column("is_organization_trail", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "cloudtrail_trails",
        sa.Column("management_account_id", sa.String(20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("cloudtrail_trails", "management_account_id")
    op.drop_column("cloudtrail_trails", "is_organization_trail")
