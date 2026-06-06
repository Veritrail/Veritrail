"""Protected branches should require CI jobs that provide security scanning evidence."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks._identity_helpers import _providers_of_type, _source_label

CHECK_ID = "gitlab.repo.security_ci_not_required"
from app.checks.base import FindingDraft, score
from app.models.github import Repo, RepoProtection

_SECURITY_FEATURES = {
    "sast": "SAST",
    "dependency_scanning": "Dependency scanning",
    "container_scanning": "Container scanning",
}


def run(db: Session, account_id) -> list[FindingDraft]:
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, "gitlab"):
        source = _source_label(provider)
        repos = db.scalars(select(Repo).where(Repo.provider_id == provider.id)).all()
        for repo in repos:
            branch = repo.default_branch or "main"
            protection = db.scalars(
                select(RepoProtection).where(
                    RepoProtection.repo_id == repo.id,
                    RepoProtection.branch == branch,
                )
            ).first()
            if not protection:
                continue
            contexts = [
                c.lower()
                for c in (protection.required_status_checks or [])
                if isinstance(c, str)
            ]
            features = repo.security_features if isinstance(repo.security_features, dict) else {}
            missing: list[str] = []
            for feature_key, label in _SECURITY_FEATURES.items():
                if features.get(feature_key) is not True:
                    continue
                if not any(feature_key.replace("_", "") in ctx.replace("_", "").replace("-", "") for ctx in contexts):
                    missing.append(label)
            if not missing:
                continue
            out.append(
                FindingDraft(
                    check_id=CHECK_ID,
                    resource_arn=f"gitlab://{source}/{repo.name}",
                    title=f"Repository `{repo.name}` protected branch does not require security CI jobs",
                    severity="medium",
                    risk_score=score("medium"),
                    evidence={
                        "repo": repo.name,
                        "source": source,
                        "missing_security_jobs": missing,
                        "required_status_checks": protection.required_status_checks,
                        "security_features": features,
                    },
                )
            )
    return out
