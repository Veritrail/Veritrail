"""SDLC evidence aggregation for audit packs and composite insights."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Finding
from app.models.github import CiPipeline, IdentityProvider, Repo, RepoProtection, WorkflowRun

_SECURITY_FEATURE_KEYS = (
    "dependabot_alerts",
    "code_scanning",
    "secret_scanning",
    "dependency_review",
)


def _capability_active(capability_evidence: dict[str, Any], capability: str) -> bool:
    """True when enablement is on AND Phase-1 evidence shows observable activity."""
    block = capability_evidence.get(capability) if isinstance(capability_evidence, dict) else None
    if isinstance(block, dict):
        return bool(block.get("enabled")) and bool(block.get("has_observable_activity"))
    return False


def _repo_security_status(repo: Repo, protection: RepoProtection | None) -> dict[str, Any]:
    features = repo.security_features if isinstance(repo.security_features, dict) else {}
    default_branch = (repo.default_branch or "main").strip()
    has_protection = protection is not None
    gaps: list[str] = []
    if not has_protection:
        gaps.append("no_branch_protection")
    for key in _SECURITY_FEATURE_KEYS:
        val = features.get(key)
        if val is False:
            gaps.append(f"{key}_disabled")
        elif val is None and repo.name and not repo.name.endswith(".disabled"):
            gaps.append(f"{key}_unknown")

    cap_map = {
        "dependabot_alerts": "dependency_scanning",
        "code_scanning": "source_code_scanning",
        "secret_scanning": "secret_scanning",
    }
    for legacy_key, cap_id in cap_map.items():
        if features.get(legacy_key) is True and not _capability_active(
            features.get("capability_evidence")
            if isinstance(features.get("capability_evidence"), dict)
            else {},
            cap_id,
        ):
            gaps.append(f"{legacy_key}_inactive")

    return {
        "name": repo.name,
        "default_branch": default_branch,
        "has_branch_protection": has_protection,
        "required_reviews": protection.required_reviews if protection else None,
        "security_features": {k: features.get(k) for k in _SECURITY_FEATURE_KEYS},
        "capability_evidence": features.get("capability_evidence")
        if isinstance(features.get("capability_evidence"), dict)
        else {},
        "gaps": gaps,
    }


def build_sdlc_evidence(db: Session, org_id: uuid.UUID, since: datetime) -> dict[str, Any]:
    """Aggregate SDLC + remediation ticket evidence for audit packs."""
    providers = db.scalars(
        select(IdentityProvider).where(IdentityProvider.org_id == org_id)
    ).all()
    provider_ids = [p.id for p in providers]
    repo_ids: list[uuid.UUID] = []
    repos: list[Repo] = []
    if provider_ids:
        repos = list(db.scalars(select(Repo).where(Repo.provider_id.in_(provider_ids))).all())
        repo_ids = [r.id for r in repos]

    workflow_run_count = 0
    ci_pipeline_count = 0
    if repo_ids:
        workflow_run_count = db.scalar(
            select(func.count())
            .select_from(WorkflowRun)
            .where(WorkflowRun.repo_id.in_(repo_ids), WorkflowRun.run_started_at >= since)
        ) or 0
        ci_pipeline_count = db.scalar(
            select(func.count())
            .select_from(CiPipeline)
            .where(CiPipeline.repo_id.in_(repo_ids), CiPipeline.created_at >= since)
        ) or 0

    protected_repos = 0
    total_repos = len(repo_ids)
    repo_details: list[dict[str, Any]] = []
    repos_without_protection: list[str] = []
    repos_with_security_gaps: list[str] = []

    for repo in repos:
        branch = (repo.default_branch or "main").strip()
        protection = db.scalar(
            select(RepoProtection).where(
                RepoProtection.repo_id == repo.id,
                RepoProtection.branch == branch,
            )
        )
        if protection:
            protected_repos += 1
        else:
            repos_without_protection.append(repo.name)
        detail = _repo_security_status(repo, protection)
        repo_details.append(detail)
        if detail["gaps"]:
            repos_with_security_gaps.append(repo.name)

    open_with_tickets = db.scalars(
        select(Finding).where(
            Finding.org_id == org_id,
            Finding.status == "open",
            Finding.remediation_ticket_key.isnot(None),
        )
    ).all()
    remediation_tickets = [
        {
            "finding_id": str(f.id),
            "check_id": f.check_id,
            "ticket_key": f.remediation_ticket_key,
            "ticket_url": f.remediation_ticket_url,
            "severity": f.severity,
            "title": f.title,
        }
        for f in open_with_tickets
    ]

    dependabot_enabled = sum(
        1 for r in repo_details if r["security_features"].get("dependabot_alerts") is True
    )
    code_scanning_enabled = sum(
        1 for r in repo_details if r["security_features"].get("code_scanning") is True
    )
    secret_scanning_enabled = sum(
        1 for r in repo_details if r["security_features"].get("secret_scanning") is True
    )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "period_start": since.isoformat(),
        "workflow_runs": workflow_run_count,
        "ci_pipelines": ci_pipeline_count,
        "repos_total": total_repos,
        "repos_with_branch_protection": protected_repos,
        "repos_without_branch_protection": repos_without_protection,
        "repos_with_security_gaps": repos_with_security_gaps,
        "dependabot_enabled_repos": dependabot_enabled,
        "code_scanning_enabled_repos": code_scanning_enabled,
        "secret_scanning_enabled_repos": secret_scanning_enabled,
        "repo_details": repo_details[:100],
        "open_findings_with_remediation_tickets": len(remediation_tickets),
        "remediation_tickets": remediation_tickets,
    }


def sdlc_insights_for_org(db: Session, org_id: uuid.UUID) -> dict[str, Any]:
    """Lightweight SDLC snapshot for composite secure_sdlc UI."""
    since = datetime.now(timezone.utc) - timedelta(days=90)
    data = build_sdlc_evidence(db, org_id, since)
    dependabot_active = sum(
        1
        for d in data["repo_details"]
        if _capability_active(d.get("capability_evidence") or {}, "dependency_scanning")
    )
    code_scanning_active = sum(
        1
        for d in data["repo_details"]
        if _capability_active(d.get("capability_evidence") or {}, "source_code_scanning")
    )
    secret_scanning_active = sum(
        1
        for d in data["repo_details"]
        if _capability_active(d.get("capability_evidence") or {}, "secret_scanning")
    )

    return {
        "repos_total": data["repos_total"],
        "repos_with_branch_protection": data["repos_with_branch_protection"],
        "repos_without_branch_protection": len(data["repos_without_branch_protection"]),
        "dependabot_enabled_repos": data["dependabot_enabled_repos"],
        "code_scanning_enabled_repos": data["code_scanning_enabled_repos"],
        "secret_scanning_enabled_repos": data["secret_scanning_enabled_repos"],
        "dependabot_active_repos": dependabot_active,
        "code_scanning_active_repos": code_scanning_active,
        "secret_scanning_active_repos": secret_scanning_active,
        "repos_with_security_gaps": len(data["repos_with_security_gaps"]),
    }
