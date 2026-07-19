"""Move identity integration findings to org scope.

Okta (testing), Entra, and Google Workspace are org-level identity domains.
Historically their checks ran inside the AWS scan and findings were attributed
to whichever AWS account was scanned. Re-point to org scope (account_id = NULL).

Revision ID: 0092
Revises: 0091
Create Date: 2026-07-08
"""
from alembic import op

revision = "0092"
down_revision = "0091"
branch_labels = None
depends_on = None

_PREFIXES = ("okta.%", "entra.%", "google_workspace.%")
_PREDICATE = " OR ".join(f"f.check_id LIKE '{p}'" for p in _PREFIXES)
_KEEP_PREDICATE = " OR ".join(f"check_id LIKE '{p}'" for p in _PREFIXES)


def upgrade() -> None:
    # 1. Drop all-but-the-earliest duplicate across accounts.
    op.execute(
        f"""
        DELETE FROM findings f
        USING findings keep
        WHERE ({_PREDICATE})
          AND f.org_id = keep.org_id
          AND f.check_id = keep.check_id
          AND f.resource_arn = keep.resource_arn
          AND f.account_id IS NOT NULL
          AND keep.account_id IS NOT NULL
          AND (
                f.first_seen > keep.first_seen
                OR (f.first_seen = keep.first_seen AND f.id > keep.id)
              )
        """
    )
    # 2. Ensure org_id is set from the former account, then clear account_id.
    op.execute(
        f"""
        UPDATE findings f
        SET org_id = COALESCE(f.org_id, a.org_id),
            account_id = NULL
        FROM aws_accounts a
        WHERE f.account_id = a.id
          AND ({_KEEP_PREDICATE.replace('check_id', 'f.check_id')})
        """
    )


def downgrade() -> None:
    # Non-reversible: original account attribution is not recoverable. No-op.
    pass
