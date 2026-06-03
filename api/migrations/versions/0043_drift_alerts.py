"""Add drift_alerts table."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0043_drift_alerts"
down_revision = "0042_auditor_portal"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "drift_alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("finding_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("alert_type", sa.String(30), nullable=False),
        sa.Column("detected_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("acknowledged", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_by", sa.String(320), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], name="drift_alerts_org_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["aws_accounts.id"], name="drift_alerts_account_id_fkey", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["finding_id"], ["findings.id"], name="drift_alerts_finding_id_fkey", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_drift_alerts_alert_type", "drift_alerts", ["alert_type"])
    op.create_index("ix_drift_alerts_detected_at", "drift_alerts", ["detected_at"])
    op.create_index("ix_drift_alerts_org_id", "drift_alerts", ["org_id"])
    op.create_index("ix_drift_alerts_account_id", "drift_alerts", ["account_id"])
    op.create_index("ix_drift_alerts_finding_id", "drift_alerts", ["finding_id"])


def downgrade() -> None:
    op.drop_table("drift_alerts")
