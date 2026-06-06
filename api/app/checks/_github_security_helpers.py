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
