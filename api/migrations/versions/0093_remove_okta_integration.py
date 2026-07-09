"""Remove Okta identity integration data.

Resolve open okta.* findings and delete Okta identity providers. Okta was
testing-only; production identity platforms are Entra ID and Google Workspace.

Revision ID: 0093
Revises: 0092
Create Date: 2026-07-08
"""
from alembic import op

revision = "0093"
down_revision = "0092"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE findings
        SET status = 'resolved',
            resolved_at = NOW()
        WHERE status = 'open'
          AND check_id LIKE 'okta.%'
        """
    )
    op.execute(
        """
        DELETE FROM identity_providers
        WHERE type = 'okta'
        """
    )


def downgrade() -> None:
    # Non-reversible: resolved findings and deleted providers cannot be restored.
    pass
