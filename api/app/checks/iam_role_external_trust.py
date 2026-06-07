"""Check: IAM role trusts an external AWS account principal."""
from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.checks.iam_role_exclusions import is_vigil_integration_role
from app.core.config import get_settings
from app.models import AwsAccount, IamRole

CHECK_ID = "iam.role.external_account_trust"

_ACCOUNT_ARN = re.compile(r"^arn:aws:iam::(\d{12}):")


def _external_account_ids(trust_policy: dict, own_account_id: str | None) -> list[str]:
    if not own_account_id:
        return []
    found: set[str] = set()
    for stmt in trust_policy.get("Statement", []):
        if stmt.get("Effect") != "Allow":
            continue
        principal = stmt.get("Principal", {})
        aws_principals: list[str] = []
        if isinstance(principal, str):
            aws_principals = [principal]
        elif isinstance(principal, dict):
            raw = principal.get("AWS", [])
            if isinstance(raw, str):
                aws_principals = [raw]
            elif isinstance(raw, list):
                aws_principals = [str(x) for x in raw]
        for p in aws_principals:
            if p == "*":
                continue
            m = _ACCOUNT_ARN.match(p)
            if m and m.group(1) != own_account_id:
                found.add(m.group(1))
    return sorted(found)


def _vigil_control_plane_account_id() -> str | None:
    arn = (get_settings().TRUST_PRINCIPAL_ARN or "").strip()
    m = _ACCOUNT_ARN.match(arn)
    return m.group(1) if m else None


def _external_ids_for_finding(external: list[str]) -> list[str]:
    """Drop Vigil control-plane account when it is the only external principal."""
    vigil_acct = _vigil_control_plane_account_id()
    if not vigil_acct:
        return external
    remaining = [a for a in external if a != vigil_acct]
    return remaining if remaining else []


def run(db: Session, account_id) -> list[FindingDraft]:
    acc = db.get(AwsAccount, account_id)
    own = acc.account_id if acc else None
    roles = db.scalars(select(IamRole).where(IamRole.account_id == account_id)).all()
    out: list[FindingDraft] = []
    for r in roles:
        if is_vigil_integration_role(r.name):
            continue
        if not r.trust_policy:
            continue
        external = _external_ids_for_finding(_external_account_ids(r.trust_policy, own))
        if not external:
            continue
        out.append(
            FindingDraft(
                check_id=CHECK_ID,
                resource_arn=r.arn,
                title=f"Role `{r.name}` trusts external AWS account(s)",
                severity="low",
                risk_score=score("low"),
                evidence={
                    "role_arn": r.arn,
                    "external_account_ids": external,
                    "trust_policy": r.trust_policy,
                },
            )
        )
    return out
