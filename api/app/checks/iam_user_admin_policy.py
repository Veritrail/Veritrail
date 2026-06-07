"""IAM users with AdministratorAccess or equivalent full-admin policies attached."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.checks.iam_role_least_privilege import _has_full_admin_allow
from app.models import IamUser

CHECK_ID = "iam.user.admin_policy_attached"

_ADMIN_MANAGED = {"AdministratorAccess", "PowerUserAccess"}


def run(db: Session, account_id) -> list[FindingDraft]:
    rows = db.scalars(select(IamUser).where(IamUser.account_id == account_id)).all()
    out: list[FindingDraft] = []
    for u in rows:
        flagged: list[str] = []
        for pol in u.attached_policies or []:
            name = pol.get("policy_name") or ""
            if name in _ADMIN_MANAGED:
                flagged.append(name)
        for pname, doc in (u.inline_policies or {}).items():
            if _has_full_admin_allow(doc if isinstance(doc, dict) else {}):
                flagged.append(f"inline:{pname}")
        if not flagged:
            continue
        out.append(
            FindingDraft(
                check_id=CHECK_ID,
                resource_arn=u.arn,
                title=f"IAM user `{u.name}` has privileged admin policy attached",
                severity="high",
                risk_score=score("high", admin=True),
                evidence={
                    "user_name": u.name,
                    "user_arn": u.arn,
                    "admin_policies": flagged,
                },
            )
        )
    return out
