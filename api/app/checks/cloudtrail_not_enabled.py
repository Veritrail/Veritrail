from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import AwsAccount
from app.models.resources import CloudTrailTrail

CHECK_ID = "cloudtrail.trail.not_enabled"


def run(db: Session, account_id) -> list[FindingDraft]:
    acc = db.get(AwsAccount, account_id)
    if not acc:
        return []

    active = db.scalars(
        select(CloudTrailTrail).where(
            CloudTrailTrail.account_id == account_id,
            CloudTrailTrail.is_multi_region == True,  # noqa: E712
            CloudTrailTrail.is_logging == True,  # noqa: E712
        )
    ).first()

    if active:
        # Check if this is an organization trail — note it in evidence
        if active.is_organization_trail:
            return []  # Covered by org trail — don't flag
        return []

    # Check for org-trail coverage (synthetic row created by collector)
    org_trail = db.scalars(
        select(CloudTrailTrail).where(
            CloudTrailTrail.account_id == account_id,
            CloudTrailTrail.is_organization_trail == True,  # noqa: E712
        )
    ).first()

    if org_trail:
        # Covered by organization trail in management account
        return [FindingDraft(
            check_id=CHECK_ID,
            resource_arn=f"arn:aws:cloudtrail:*:{acc.account_id or 'unknown'}:trail",
            title="CloudTrail is covered by an organization trail",
            severity="low",
            risk_score=score("low"),
            evidence={
                "account_id": acc.account_id,
                "org_trail_coverage": True,
                "management_account_id": org_trail.management_account_id,
                "trail_arn": org_trail.arn if org_trail.arn != f"arn:aws:cloudtrail:*:{org_trail.management_account_id or 'unknown'}:trail/org-trail" else None,
                "note": (
                    f"Covered by organization trail in management account "
                    f"{org_trail.management_account_id}. No additional trail needed."
                ),
            },
        )]

    return [FindingDraft(
        check_id=CHECK_ID,
        resource_arn=f"arn:aws:cloudtrail:*:{acc.account_id or 'unknown'}:trail",
        title="No multi-region CloudTrail trail is enabled",
        severity="high",
        risk_score=score("high"),
        evidence={"account_id": acc.account_id},
    )]
