"""Check: no IAM or Identity Center users visible — possible SSO blind spot."""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.iam import IamUser
from app.models.resources import IdentityCenterUser

CHECK_ID = "iam.access_inventory_gap"


def run(db: Session, account_id) -> list[FindingDraft]:
    iam_count = db.scalar(
        select(func.count()).select_from(IamUser).where(IamUser.account_id == account_id)
    ) or 0
    ic_count = db.scalar(
        select(func.count()).select_from(IdentityCenterUser).where(IdentityCenterUser.account_id == account_id)
    ) or 0
    if iam_count > 0 or ic_count > 0:
        return []
    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=f"arn:aws:iam::{account_id}:inventory",
            title="No IAM or Identity Center users collected",
            severity="medium",
            risk_score=score("medium"),
            evidence={
                "iam_user_count": iam_count,
                "identity_center_user_count": ic_count,
                "note": (
                    "If the organization uses IAM Identity Center (SSO), ensure the Veritrail role can "
                    "list Identity Center users. If access is federated elsewhere, document manually for auditors."
                ),
            },
        )
    ]
