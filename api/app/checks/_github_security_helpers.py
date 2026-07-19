"""Shared helpers for GitHub Advanced Security metadata checks."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks._identity_helpers import _providers_of_type, _source_label
from app.checks.base import FindingDraft, score
from app.models.github import Repo

FEATURE_LABELS = {
    "dependabot_alerts": "Dependabot vulnerability alerts",
    "code_scanning": "Code scanning (CodeQL)",
    "secret_scanning": "Secret scanning",
}

# Map enablement feature keys → capability_evidence lane keys (Phase 1).
FEATURE_CAPABILITY_KEYS = {
    "dependabot_alerts": "dependency_scanning",
    "code_scanning": "source_code_scanning",
    "secret_scanning": "secret_scanning",
}


def run_missing_security_feature(
    db: Session,
    account_id,
    feature_key: str,
    check_id: str,
) -> list[FindingDraft]:
    label = FEATURE_LABELS.get(feature_key, feature_key)
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, "github"):
        source = _source_label(provider)
        repos = db.scalars(select(Repo).where(Repo.provider_id == provider.id)).all()
        for repo in repos:
            features = repo.security_features if isinstance(repo.security_features, dict) else {}
            enabled = features.get(feature_key)
            if enabled is not False:
                continue
            out.append(
                FindingDraft(
                    check_id=check_id,
                    resource_arn=f"github://{source}/{repo.name}",
                    title=f"Repository `{repo.name}` does not have {label} enabled",
                    severity="medium",
                    risk_score=score("medium"),
                    evidence={
                        "repo": repo.name,
                        "source": source,
                        "feature": feature_key,
                        "feature_label": label,
                        "security_features": features,
                    },
                )
            )
    return out


def run_inactive_security_feature(
    db: Session,
    account_id,
    feature_key: str,
    check_id: str,
) -> list[FindingDraft]:
    """Enabled feature without observable scan/alert activity → Action needed.

    Spec: enablement alone must not verify a capability lane.
    """
    label = FEATURE_LABELS.get(feature_key, feature_key)
    cap_key = FEATURE_CAPABILITY_KEYS.get(feature_key)
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, "github"):
        source = _source_label(provider)
        repos = db.scalars(select(Repo).where(Repo.provider_id == provider.id)).all()
        for repo in repos:
            features = repo.security_features if isinstance(repo.security_features, dict) else {}
            if features.get(feature_key) is not True:
                continue
            cap_ev = features.get("capability_evidence") if isinstance(features.get("capability_evidence"), dict) else {}
            block = cap_ev.get(cap_key) if cap_key and isinstance(cap_ev.get(cap_key), dict) else {}
            # Legacy snapshots without capability_evidence: treat as inactive.
            if block:
                if block.get("has_observable_activity"):
                    continue
                if block.get("permission_status") in ("denied", "unavailable_by_plan"):
                    # Graded as unknown at lane level; skip duplicate enablement gap.
                    continue
            out.append(
                FindingDraft(
                    check_id=check_id,
                    resource_arn=f"github://{source}/{repo.name}/inactive/{feature_key}",
                    title=(
                        f"Repository `{repo.name}` has {label} enabled but no observable "
                        "security scan or alert activity"
                    ),
                    severity="medium",
                    risk_score=score("medium"),
                    evidence={
                        "repo": repo.name,
                        "source": source,
                        "feature": feature_key,
                        "feature_label": label,
                        "capability": cap_key,
                        "capability_evidence": block or None,
                        "limitation": "enabled_without_observable_activity",
                    },
                )
            )
    return out
