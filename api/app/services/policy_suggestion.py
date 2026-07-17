"""Helpers for the read-only least-privilege policy suggestion.

Derived from IAM last-accessed data only. The advanced Access Analyzer / CloudTrail
policy-generation path was retired; nothing here starts jobs or mutates AWS.
"""
from __future__ import annotations

CONFIDENCE_HIGH = "high"
CONFIDENCE_MEDIUM = "medium"
CONFIDENCE_LOW = "low"

_SECURITY_FINDING_TYPES = {"ERROR", "SECURITY_WARNING"}


def confidence_for(*, aa_resource_data: bool, has_action_data: bool) -> str:
    """Medium when action-level evidence exists, low otherwise (read-only has no resource ARNs)."""
    if aa_resource_data:
        return CONFIDENCE_HIGH
    if has_action_data:
        return CONFIDENCE_MEDIUM
    return CONFIDENCE_LOW


def validate_policy(client, policy_document: str, policy_type: str = "IDENTITY_POLICY") -> list[dict]:
    findings: list[dict] = []
    next_token: str | None = None
    while True:
        kwargs = {"policyDocument": policy_document, "policyType": policy_type}
        if next_token:
            kwargs["nextToken"] = next_token
        resp = client.validate_policy(**kwargs)
        for f in resp.get("findings", []) or []:
            findings.append(
                {
                    "finding_type": f.get("findingType"),
                    "issue_code": f.get("issueCode"),
                    "detail": f.get("findingDetails"),
                    "learn_more": f.get("learnMoreLink"),
                }
            )
        next_token = resp.get("nextToken")
        if not next_token:
            break
    return findings


def security_findings_only(findings: list[dict]) -> list[dict]:
    return [f for f in findings if (f.get("finding_type") or "").upper() in _SECURITY_FINDING_TYPES]
