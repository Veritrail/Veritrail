from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import IamRole

CHECK_ID = "iam.role.wildcard_action"


def run(db: Session, account_id) -> list[FindingDraft]:
    roles = db.scalars(select(IamRole).where(IamRole.account_id == account_id)).all()
    out: list[FindingDraft] = []
    for r in roles:
        if "/aws-service-role/" in r.arn:
            continue
        inline_flagged = []
        for pname, doc in (r.inline_policies or {}).items():
            if _has_wildcard_action(doc):
                inline_flagged.append(pname)

        attached_flagged = []
        for pol in (r.attached_policies or []):
            if pol.get("policy_type") == "aws_managed":
                continue  # AWS managed wildcards are expected (e.g. AdministratorAccess)
            stmts = pol.get("statements", [])
            if _has_wildcard_action({"Statement": stmts}):
                attached_flagged.append(pol["policy_name"])

        if inline_flagged or attached_flagged:
            sources = []
            if inline_flagged:
                sources.append(f"inline: {', '.join(inline_flagged)}")
            if attached_flagged:
                sources.append(f"customer managed: {', '.join(attached_flagged)}")
            out.append(
                FindingDraft(
                    check_id=CHECK_ID,
                    resource_arn=r.arn,
                    title=f"Role `{r.name}` has wildcard Action in a policy (not necessarily full admin)",
                    severity="high",
                    risk_score=score("high", admin=True),
                    evidence={
                        "role_arn": r.arn,
                        "inline_policies_with_wildcard": inline_flagged,
                        "attached_policies_with_wildcard": attached_flagged,
                        "sources": sources,
                    },
                )
            )
    return out


def _has_wildcard_action(doc: dict) -> bool:
    for stmt in doc.get("Statement", []):
        if stmt.get("Effect") != "Allow":
            continue
        action = stmt.get("Action", [])
        if isinstance(action, str):
            action = [action]
        if "*" not in action:
            continue
        # Skip full-admin (Action:* AND Resource:*) — owned by iam.role.full_admin_policy,
        # so a full-admin role isn't double-flagged here.
        resource = stmt.get("Resource", [])
        if isinstance(resource, str):
            resource = [resource]
        if "*" in resource:
            continue
        return True
    return False
