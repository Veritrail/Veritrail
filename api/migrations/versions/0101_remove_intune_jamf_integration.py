"""Remove Intune/Jamf MDM sync data.

Resolve open intune.*/jamf.* findings and delete Intune/Jamf identity
providers. The MDM device-sync path was removed with the MDM composite:
device-encryption posture is no longer collected or graded, so stale
findings must not keep influencing control status.

Revision ID: 0101
Revises: 0100
Create Date: 2026-07-20
"""
from alembic import op

revision = "0101"
down_revision = "0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE findings
        SET status = 'resolved',
            resolved_at = NOW()
        WHERE status = 'open'
          AND (check_id LIKE 'intune.%' OR check_id LIKE 'jamf.%')
        """
    )
    op.execute(
        """
        DELETE FROM identity_providers
        WHERE type IN ('intune', 'jamf')
        """
    )


def downgrade() -> None:
    # Non-reversible: resolved findings and deleted providers cannot be restored.
    pass
