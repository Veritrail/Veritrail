"""Merge iam.role.full_admin_policy + wildcard_action into least_privilege_policy."""
from alembic import op

revision = "0054"
down_revision = "0053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop duplicate open rows when the same role already has the merged check_id
    # (can happen if both legacy checks were open before detection deduped them).
    op.execute(
        """
        DELETE FROM findings legacy
        WHERE legacy.check_id IN ('iam.role.full_admin_policy', 'iam.role.wildcard_action')
          AND EXISTS (
            SELECT 1 FROM findings newer
            WHERE newer.account_id = legacy.account_id
              AND newer.resource_arn = legacy.resource_arn
              AND newer.check_id = 'iam.role.least_privilege_policy'
              AND newer.id <> legacy.id
          )
        """
    )
    # If both legacy checks exist for one role, keep full_admin (worst case) and drop wildcard.
    op.execute(
        """
        DELETE FROM findings wild
        WHERE wild.check_id = 'iam.role.wildcard_action'
          AND EXISTS (
            SELECT 1 FROM findings admin
            WHERE admin.account_id = wild.account_id
              AND admin.resource_arn = wild.resource_arn
              AND admin.check_id = 'iam.role.full_admin_policy'
          )
        """
    )
    op.execute(
        """
        UPDATE findings
        SET check_id = 'iam.role.least_privilege_policy'
        WHERE check_id IN ('iam.role.full_admin_policy', 'iam.role.wildcard_action')
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE findings
        SET check_id = 'iam.role.full_admin_policy'
        WHERE check_id = 'iam.role.least_privilege_policy'
          AND (evidence->>'scope') = 'full_admin'
        """
    )
    op.execute(
        """
        UPDATE findings
        SET check_id = 'iam.role.wildcard_action'
        WHERE check_id = 'iam.role.least_privilege_policy'
          AND (evidence->>'scope') = 'wildcard_action'
        """
    )
