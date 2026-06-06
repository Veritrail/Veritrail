"""Branch protection required status checks should include enabled security workflows."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks._github_security_helpers import FEATURE_LABELS

CHECK_ID = "github.repo.security_status_checks_missing"
from app.checks._identity_helpers import _providers_of_type, _source_label
from app.checks.base import FindingDraft, score
from app.models.github import Repo, RepoProtection

_SECURITY_CONTEXT_PATTERNS = {
    "dependabot_alerts": ("dependabot",),
    "code_scanning": ("codeql", "code scanning", "code-scanning"),
    "secret_scanning": ("secret scanning", "secret-scanning", "gitleaks"),
}


def run(db: Session, account_id) -> list[FindingDraft]:
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, "github"):
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
            for feature_key, patterns in _SECURITY_CONTEXT_PATTERNS.items():
                if features.get(feature_key) is not True:
                    continue
                if not any(any(p in ctx for p in patterns) for ctx in contexts):
                    missing.append(FEATURE_LABELS.get(feature_key, feature_key))
            if not missing:
                continue
            out.append(
                FindingDraft(
                    check_id=CHECK_ID,
                    resource_arn=f"github://{source}/{repo.name}",
                    title=f"Repository `{repo.name}` branch protection missing required security status checks",
                    severity="medium",
                    risk_score=score("medium"),
                    evidence={
                        "repo": repo.name,
                        "source": source,
                        "missing_security_contexts": missing,
                        "required_status_checks": protection.required_status_checks,
                        "security_features": features,
                    },
                )
            )
    return out
