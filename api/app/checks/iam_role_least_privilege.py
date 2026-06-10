"""IAM role policies that violate least privilege (Action:* with or without Resource:*)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models import IamRole

CHECK_ID = "iam.role.least_privilege_policy"

SCOPE_FULL_ADMIN = "full_admin"
SCOPE_WILDCARD_ACTION = "wildcard_action"


def draft_for_role(r: IamRole) -> FindingDraft | None:
    if "/aws-service-role/" in r.arn:
        return None
    inline_full, inline_wild = _classify_inline(r.inline_policies or {})
    attached_full, attached_wild = _classify_attached(r.attached_policies or [])

    if not (inline_full or inline_wild or attached_full or attached_wild):
        return None

    scope = SCOPE_FULL_ADMIN if (inline_full or attached_full) else SCOPE_WILDCARD_ACTION
    risk_line, title_suffix = _copy_for_scope(scope)
    sources = _format_sources(inline_full, inline_wild, attached_full, attached_wild)

    return FindingDraft(
        check_id=CHECK_ID,
        resource_arn=r.arn,
        title=f"Role `{r.name}` — {title_suffix}",
        severity="high",
        risk_score=score("high", admin=True),
        evidence={
            "role_arn": r.arn,
            "scope": scope,
            "risk": risk_line,
            "inline_policies_full_admin": inline_full,
            "inline_policies_wildcard_action": inline_wild,
            "attached_policies_full_admin": attached_full,
            "attached_policies_wildcard_action": attached_wild,
            "sources": sources,
        },
    )


def still_failing_arn(db: Session, account_id, resource_arn: str) -> bool:
    r = db.scalar(
        select(IamRole).where(IamRole.account_id == account_id, IamRole.arn == resource_arn),
    )
    if not r:
        return False
    return draft_for_role(r) is not None


def run(db: Session, account_id) -> list[FindingDraft]:
    roles = db.scalars(select(IamRole).where(IamRole.account_id == account_id)).all()
    out: list[FindingDraft] = []
    for r in roles:
        draft = draft_for_role(r)
        if draft:
            out.append(draft)
    return out


def _copy_for_scope(scope: str) -> tuple[str, str]:
    if scope == SCOPE_FULL_ADMIN:
        return (
            "Role has customer-managed Action:* and Resource:* (full admin).",
            "least privilege violation (Action:* and Resource:*)",
        )
    return (
        "Role has customer-managed Action:* on scoped resources.",
        "least privilege violation (Action:*)",
    )


def _format_sources(
    inline_full: list[str],
    inline_wild: list[str],
    attached_full: list[str],
    attached_wild: list[str],
) -> list[str]:
    sources: list[str] = []
    if inline_full:
        sources.append(f"inline full admin: {', '.join(inline_full)}")
    if inline_wild:
        sources.append(f"inline Action:*: {', '.join(inline_wild)}")
    if attached_full:
        sources.append(f"customer managed full admin: {', '.join(attached_full)}")
    if attached_wild:
        sources.append(f"customer managed Action:*: {', '.join(attached_wild)}")
    return sources


def _classify_inline(policies: dict) -> tuple[list[str], list[str]]:
    full: list[str] = []
    wild: list[str] = []
    for pname, doc in policies.items():
        if _has_full_admin_allow(doc):
            full.append(pname)
        elif _has_wildcard_action_only(doc):
            wild.append(pname)
    return full, wild


def _classify_attached(policies: list) -> tuple[list[str], list[str]]:
    full: list[str] = []
    wild: list[str] = []
    for pol in policies:
        if pol.get("policy_type") == "aws_managed":
            continue
        name = pol["policy_name"]
        doc = {"Statement": pol.get("statements", [])}
        if _has_full_admin_allow(doc):
            full.append(name)
        elif _has_wildcard_action_only(doc):
            wild.append(name)
    return full, wild


def _has_full_admin_allow(doc: dict) -> bool:
    for stmt in doc.get("Statement", []):
        if stmt.get("Effect") != "Allow":
            continue
        action = stmt.get("Action", [])
        if isinstance(action, str):
            action = [action]
        if "*" not in action:
            continue
        resource = stmt.get("Resource", [])
        if isinstance(resource, str):
            resource = [resource]
        if "*" in resource:
            return True
    return False


def _has_wildcard_action_only(doc: dict) -> bool:
    for stmt in doc.get("Statement", []):
        if stmt.get("Effect") != "Allow":
            continue
        action = stmt.get("Action", [])
        if isinstance(action, str):
            action = [action]
        if "*" not in action:
            continue
        resource = stmt.get("Resource", [])
        if isinstance(resource, str):
            resource = [resource]
        if "*" in resource:
            continue
        return True
    return False
