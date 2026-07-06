"""Move source-control (GitHub/GitLab) findings to org scope.

Secure SDLC is an org-level source-control domain, not a per-cloud-account
control. Historically the github.*/gitlab.* checks ran inside the AWS scan and
their findings were attributed to whichever AWS account was scanned. This
re-points them to org scope (account_id = NULL) so they grade independent of
any cloud account.

Dedup first: if the same repo finding was attributed to several accounts (the
check ran in each account's scan), collapse to one org-scoped row per
(org_id, check_id, resource_arn), keeping the earliest first_seen.

Revision ID: 0090
Revises: 0089
Create Date: 2026-07-06
"""
from alembic import op

revision = "0090"
down_revision = "0089"
branch_labels = None
depends_on = None

_SC_PREDICATE = "(check_id LIKE 'github.%' OR check_id LIKE 'gitlab.%')"


def upgrade() -> None:
    # 1. Drop all-but-the-earliest duplicate across accounts.
    op.execute(
        f"""
        DELETE FROM findings f
        USING findings keep
        WHERE {_SC_PREDICATE.replace('check_id', 'f.check_id')}
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
    # 2. Re-point survivors to org scope.
    op.execute(
        f"UPDATE findings SET account_id = NULL WHERE {_SC_PREDICATE} AND account_id IS NOT NULL"
    )


def downgrade() -> None:
    # Non-reversible: original account attribution is not recoverable. No-op.
    pass
