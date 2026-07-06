"""Composite indexes for findings list + keyset pagination.

Revision ID: 0091
Revises: 0090
Create Date: 2026-07-06
"""
from alembic import op

revision = "0091"
down_revision = "0090"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_findings_org_account_status_score_id",
        "findings",
        ["org_id", "account_id", "status", "risk_score", "id"],
        postgresql_ops={"risk_score": "DESC", "id": "DESC"},
    )
    op.drop_index("ix_findings_org_status_score", table_name="findings")
    op.create_index(
        "ix_findings_org_status_score_id",
        "findings",
        ["org_id", "status", "risk_score", "id"],
        postgresql_ops={"risk_score": "DESC", "id": "DESC"},
    )


def downgrade() -> None:
    op.drop_index("ix_findings_org_status_score_id", table_name="findings")
    op.create_index(
        "ix_findings_org_status_score",
        "findings",
        ["org_id", "status", "risk_score"],
        postgresql_ops={"risk_score": "DESC"},
    )
    op.drop_index("ix_findings_org_account_status_score_id", table_name="findings")
