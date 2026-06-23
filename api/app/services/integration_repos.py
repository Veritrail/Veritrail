from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.github import PullRequest, Repo, RepoProtection

ProtectionStatus = Literal["protected", "missing", "review"]


class RepoInScopeOut(BaseModel):
    full_name: str
    short_name: str
    protection_status: ProtectionStatus
    last_evidence_at: str | None
    activity_count: int


def _protection_status(protections: list[RepoProtection]) -> ProtectionStatus:
    if not protections:
        return "missing"
    if any(p.required_reviews >= 1 for p in protections):
        return "protected"
    return "review"


def count_protected_repos(db: Session, provider_id: uuid.UUID) -> int:
    """Repos with required reviews on at least one branch protection rule."""
    repos = db.scalars(select(Repo).where(Repo.provider_id == provider_id)).all()
    total = 0
    for repo in repos:
        protections = db.scalars(select(RepoProtection).where(RepoProtection.repo_id == repo.id)).all()
        if _protection_status(protections) == "protected":
            total += 1
    return total


def list_repos_in_scope(db: Session, provider_id: uuid.UUID) -> list[RepoInScopeOut]:
    repos = db.scalars(select(Repo).where(Repo.provider_id == provider_id).order_by(Repo.name)).all()
    rows: list[RepoInScopeOut] = []
    for repo in repos:
        protections = db.scalars(select(RepoProtection).where(RepoProtection.repo_id == repo.id)).all()
        pr_count = db.scalar(select(func.count()).select_from(PullRequest).where(PullRequest.repo_id == repo.id)) or 0
        short_name = repo.name.rsplit("/", 1)[-1]
        rows.append(
            RepoInScopeOut(
                full_name=repo.name,
                short_name=short_name,
                protection_status=_protection_status(protections),
                last_evidence_at=repo.snapshot_taken_at.isoformat() if repo.snapshot_taken_at else None,
                activity_count=pr_count,
            )
        )
    return rows
