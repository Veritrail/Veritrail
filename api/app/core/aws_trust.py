"""IAM trust helpers for local SSO + VeritrailReadOnly."""
from __future__ import annotations

import copy
from typing import Any


def parse_role_account(role_arn: str) -> str | None:
    """Extract AWS account id from an IAM role ARN (``arn:aws:iam::123456789012:role/...``)."""
    parts = role_arn.split(":")
    if len(parts) < 5:
        return None
    # IAM ARNs use an empty region field: arn:aws:iam::ACCOUNT:role/NAME
    if parts[2] == "iam" and parts[3] == "":
        return parts[4] or None
    return parts[3] or None


def parse_role_name(role_arn: str) -> str | None:
    if ":role/" not in role_arn:
        return None
    return role_arn.split(":role/", 1)[1]


def trust_allows_principal(doc: dict[str, Any], principal_arn: str, external_id: str) -> bool:
    for stmt in doc.get("Statement", []):
        if stmt.get("Effect") != "Allow":
            continue
        action = stmt.get("Action")
        actions = action if isinstance(action, list) else [action]
        if "sts:AssumeRole" not in actions:
            continue
        principal = stmt.get("Principal", {})
        aws = principal.get("AWS")
        if isinstance(aws, list):
            principals = aws
        elif aws:
            principals = [aws]
        else:
            continue
        if principal_arn not in principals:
            continue
        cond = (stmt.get("Condition") or {}).get("StringEquals") or {}
        if cond.get("sts:ExternalId") == external_id:
            return True
    return False


def merge_trust_principal(
    doc: dict[str, Any],
    principal_arn: str,
    external_id: str,
) -> dict[str, Any]:
    """Return updated trust policy; add principal+externalId statement if missing."""
    out = copy.deepcopy(doc)
    if trust_allows_principal(out, principal_arn, external_id):
        return out
    out.setdefault("Version", "2012-10-17")
    out.setdefault("Statement", []).append({
        "Effect": "Allow",
        "Principal": {"AWS": principal_arn},
        "Action": "sts:AssumeRole",
        "Condition": {"StringEquals": {"sts:ExternalId": external_id}},
    })
    out.setdefault("Statement", []).append({
        "Effect": "Allow",
        "Principal": {"AWS": principal_arn},
        "Action": ["sts:SetSourceIdentity", "sts:TagSession"],
    })
    return out
