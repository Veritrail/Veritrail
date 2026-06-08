"""IAM least-privilege SSM plans — gated on generated policy + CloudTrail confidence."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import AwsAccount, Finding

IAM_LEAST_PRIVILEGE_CHECK = "iam.role.least_privilege_policy"
CONFIDENCE_HIGH = "high"


class IamPolicyRemediationNotReady(Exception):
    """Dispatch blocked until CloudTrail policy generation reaches high confidence."""

    def __init__(self, detail: dict[str, Any]):
        self.detail = detail
        super().__init__(detail.get("message", "iam_policy_not_ready"))


def iam_supported_action_for_evidence(evidence: dict[str, Any]) -> str:
    inline_full = evidence.get("inline_policies_full_admin") or []
    inline_wild = evidence.get("inline_policies_wildcard_action") or []
    attached_full = evidence.get("attached_policies_full_admin") or []
    if inline_full or inline_wild:
        return "replace_wildcard_inline"
    if evidence.get("scope") == "full_admin" and attached_full:
        return "detach_full_admin"
    return "replace_wildcard_inline"


def _normalize_evidence_for_handler(evidence: dict[str, Any], action: str) -> dict[str, Any]:
    out = dict(evidence)
    if action == "detach_full_admin":
        out["attached_policies_full_admin"] = evidence.get("attached_policies_full_admin") or []
    if action == "replace_wildcard_inline":
        names = evidence.get("inline_policies_full_admin") or evidence.get(
            "inline_policies_wildcard_action"
        ) or []
        out["policy_names"] = names
    return out


def _pick_replacement_policy(generated: dict[str, Any], evidence: dict[str, Any]) -> dict | None:
    cleaned = generated.get("cleaned_policies") or {}
    if not cleaned:
        return None
    names = evidence.get("inline_policies_full_admin") or evidence.get(
        "inline_policies_wildcard_action"
    ) or []
    for name in names:
        doc = cleaned.get(name)
        if isinstance(doc, dict):
            return doc
    first = next(iter(cleaned.values()), None)
    return first if isinstance(first, dict) else None


def _gate_detail(generated: dict[str, Any]) -> dict[str, Any]:
    confidence = generated.get("confidence") or "low"
    return {
        "code": "iam_policy_confidence_gate",
        "message": (
            "Automated fix uses the least-privilege proposal from CloudTrail and IAM usage. "
            "Run CloudTrail analysis and rebuild the suggestion when confidence is high, then try again."
        ),
        "confidence": confidence,
        "confidence_note": generated.get("confidence_note"),
        "improve_via_cloudtrail": generated.get("improve_via_cloudtrail"),
        "cloudtrail_analysis": generated.get("cloudtrail_analysis"),
        "access_analyzer": generated.get("access_analyzer"),
    }


def load_role_generated_policy(db: Session, acc: AwsAccount, role_arn: str) -> dict[str, Any]:
    from app.routes.accounts import build_role_generated_policy

    return build_role_generated_policy(db, acc, role_arn, advanced=True)


def enrich_iam_least_privilege_plan(db: Session, finding: Finding, plan: dict[str, Any]) -> dict[str, Any]:
    """Attach generated policy to the SSM plan; require high confidence before dispatch."""
    if finding.check_id != IAM_LEAST_PRIVILEGE_CHECK:
        return plan

    acc = db.get(AwsAccount, finding.account_id)
    if not acc:
        raise ValueError("account not found")

    generated = load_role_generated_policy(db, acc, finding.resource_arn)
    if generated.get("confidence") != CONFIDENCE_HIGH:
        raise IamPolicyRemediationNotReady(_gate_detail(generated))

    ev = finding.evidence or {}
    action = iam_supported_action_for_evidence(ev)
    plan["supported_action"] = action
    plan["evidence"] = _normalize_evidence_for_handler(ev, action)
    plan["policy_confidence"] = generated.get("confidence")
    plan["policy_source"] = generated.get("source_label")
    plan["observed_action_count"] = generated.get("observed_action_count")

    if action == "replace_wildcard_inline":
        replacement = _pick_replacement_policy(generated, ev)
        if not replacement:
            raise IamPolicyRemediationNotReady(
                {
                    **_gate_detail(generated),
                    "message": (
                        "No inline least-privilege proposal is available for this role. "
                        "Open Suggested policy, rebuild the suggestion, then try automated fix again."
                    ),
                }
            )
        plan["replacement_policy"] = replacement
        plan["replacement_policy_names"] = list((generated.get("cleaned_policies") or {}).keys())

    return plan
