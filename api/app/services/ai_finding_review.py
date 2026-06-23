"""Org-level AI finding review: feature flag + local rules-based triage."""

from __future__ import annotations

from datetime import datetime, timezone

from app.models import Finding
from app.models.org import Org

FEATURE_KEY = "ai_finding_review_enabled"
LEGACY_FEATURE_KEY = "ai_triage_enabled"
LOCAL_MODEL_VERSION = "veritrail-local-review-v1"


def llm_triage_available() -> bool:
    """True when an OpenAI-compatible endpoint is configured."""
    from app.core.config import get_settings
    from app.services.ai_triage import llm_config_error

    settings = get_settings()
    return bool(settings.AI_TRIAGE_ENABLED and llm_config_error() is None)


def org_ai_finding_review_enabled(org: Org | None) -> bool:
    """Whether this org wants AI review in the UI and on scans. Defaults to on."""
    if org is None:
        return True
    features = (org.settings or {}).get("features") or {}
    if FEATURE_KEY in features:
        return bool(features[FEATURE_KEY])
    if LEGACY_FEATURE_KEY in features:
        return bool(features[LEGACY_FEATURE_KEY])
    return True


def heuristic_triage_payload(finding: Finding) -> dict:
    """Rules-based review (no external LLM). Same shape as stored triage API rows."""
    evidence = finding.evidence or {}
    severity_weight = {
        "critical": 0.9,
        "high": 0.8,
        "medium": 0.58,
        "low": 0.38,
    }.get(finding.severity, 0.5)
    resource_count = evidence.get("resource_count") or evidence.get("affected_count") or 1
    try:
        resource_count = int(resource_count)
    except (TypeError, ValueError):
        resource_count = 1
    confidence = min(0.96, severity_weight + (0.04 if resource_count > 1 else 0))

    if finding.severity in {"critical", "high"}:
        suggested_action = "resolve"
    elif finding.status == "excepted":
        suggested_action = "snooze"
    else:
        suggested_action = "review"

    rationale_bits = [
        f"{finding.severity.capitalize()} severity finding on {resource_count} resource{'s' if resource_count != 1 else ''}.",
        "Veritrail recommends validating the resource context, then using remediation or Verify after fixing.",
    ]
    if finding.check_id.startswith("iam."):
        rationale_bits.append(
            "Identity findings should be treated carefully because permission changes can affect workloads."
        )
    if finding.check_id.startswith("s3."):
        rationale_bits.append(
            "Storage findings often have direct audit impact and should be fixed or exceptioned with evidence."
        )

    return {
        "id": f"heuristic-{finding.id}",
        "finding_id": str(finding.id),
        "confidence_score": round(confidence, 2),
        "rationale": " ".join(rationale_bits),
        "suggested_action": suggested_action,
        "model_version": LOCAL_MODEL_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def apply_heuristic_triage(db, finding: Finding) -> "AITriageResult":
    """Persist rules-based triage for a finding."""
    from app.models.ai_triage import AITriageResult
    from app.services.ai_triage_store import save_triage_result

    payload = heuristic_triage_payload(finding)
    return save_triage_result(
        db,
        finding,
        confidence_score=payload["confidence_score"],
        rationale=payload["rationale"],
        suggested_action=payload["suggested_action"],
        model_version=LOCAL_MODEL_VERSION,
    )
