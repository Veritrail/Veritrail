"""Shared query helpers for GitHub/GitLab identity checks."""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.github import IdentityProvider, IdentityUser, PullRequest, Repo, RepoProtection

DORMANT_DAYS = 90

_PROD_LIKE_ENV = re.compile(r"(^|[/_-])(prod(uction)?|live|prd)([_/-]|$)", re.I)


def _is_prod_like_env(name: str) -> bool:
    return bool(_PROD_LIKE_ENV.search(name))


def _providers_of_type(db: Session, account_id, provider_type: str) -> list[IdentityProvider]:
    from app.models import AwsAccount
    acc = db.get(AwsAccount, account_id)
    if not acc:
        return []
    return list(db.scalars(
        select(IdentityProvider).where(
            IdentityProvider.org_id == acc.org_id,
            IdentityProvider.type == provider_type,
        )
    ).all())


def _source_label(provider: IdentityProvider) -> str:
    try:
        cfg = json.loads(provider.config_json_encrypted or "{}")
    except Exception:
        cfg = {}
    if provider.type == "github":
        return cfg.get("org_login") or cfg.get("login") or "github"
    if provider.type == "google_workspace":
        return cfg.get("domain") or cfg.get("admin_email") or "google_workspace"
    if provider.type == "entra_id":
        return cfg.get("tenant_id") or cfg.get("admin_email") or "entra"
    if provider.type == "okta":
        return cfg.get("org_url") or "okta"
    if provider.type == "intune":
        return cfg.get("tenant_id") or "intune"
    if provider.type == "jamf":
        return cfg.get("base_url") or "jamf"
    groups = cfg.get("group_ids") or ([cfg["group_id"]] if cfg.get("group_id") else [])
    return groups[0] if groups else cfg.get("username") or "gitlab"


def run_mfa_not_enforced(db: Session, account_id, provider_type: str, check_id: str) -> list[FindingDraft]:
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, provider_type):
        source = _source_label(provider)
        users = db.scalars(
            select(IdentityUser).where(
                IdentityUser.provider_id == provider.id,
                IdentityUser.status == "active",
                IdentityUser.mfa_enabled.is_(False),
            )
        ).all()
        for u in users:
            out.append(FindingDraft(
                check_id=check_id,
                resource_arn=f"{provider_type}://{source}/{u.external_id}",
                title=f"Member `{u.external_id}` does not have MFA enabled",
                severity="high",
                risk_score=score("high"),
                evidence={
                    "provider_type": provider_type,
                    "source": source,
                    "username": u.external_id,
                    "email": u.email,
                    "mfa_enabled": False,
                },
            ))
    return out


def run_dormant_members(db: Session, account_id, provider_type: str, check_id: str) -> list[FindingDraft]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=DORMANT_DAYS)
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, provider_type):
        source = _source_label(provider)
        users = db.scalars(
            select(IdentityUser).where(
                IdentityUser.provider_id == provider.id,
                IdentityUser.status == "active",
            )
        ).all()
        for u in users:
            if u.last_active_at is not None and u.last_active_at >= cutoff:
                continue
            days = (datetime.now(timezone.utc) - u.last_active_at).days if u.last_active_at else None
            out.append(FindingDraft(
                check_id=check_id,
                resource_arn=f"{provider_type}://{source}/{u.external_id}",
                title=f"Member `{u.external_id}` has not been active for {days or '90+'} days",
                severity="medium",
                risk_score=score("medium", age_days=days or DORMANT_DAYS),
                evidence={
                    "provider_type": provider_type,
                    "source": source,
                    "username": u.external_id,
                    "email": u.email,
                    "last_active_at": u.last_active_at.isoformat() if u.last_active_at else None,
                    "days_inactive": days,
                    "threshold_days": DORMANT_DAYS,
                },
            ))
    return out


def run_no_codeowners(db: Session, account_id, provider_type: str, check_id: str) -> list[FindingDraft]:
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, provider_type):
        source = _source_label(provider)
        repos = db.scalars(select(Repo).where(Repo.provider_id == provider.id)).all()
        for repo in repos:
            if repo.has_codeowners is not False:
                continue
            out.append(
                FindingDraft(
                    check_id=check_id,
                    resource_arn=f"{provider_type}://{source}/{repo.name}",
                    title=f"Repository `{repo.name}` has no CODEOWNERS file",
                    severity="medium",
                    risk_score=score("medium"),
                    evidence={
                        "provider_type": provider_type,
                        "source": source,
                        "repo": repo.name,
                        "has_codeowners": False,
                        "note": "Optional hygiene — not a mapped SOC 2/CIS/ISO control. Enable branch protection and required reviews for audit evidence.",
                    },
                )
            )
    return out


def run_no_branch_protection(db: Session, account_id, provider_type: str, check_id: str) -> list[FindingDraft]:
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, provider_type):
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
            if protection:
                continue
            out.append(FindingDraft(
                check_id=check_id,
                resource_arn=f"{provider_type}://{source}/{repo.name}",
                title=f"Repository `{repo.name}` has no branch protection on `{branch}`",
                severity="high",
                risk_score=score("high"),
                evidence={
                    "provider_type": provider_type,
                    "source": source,
                    "repo": repo.name,
                    "default_branch": branch,
                },
            ))
    return out


def run_self_merge(db: Session, account_id, provider_type: str, check_id: str) -> list[FindingDraft]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=DORMANT_DAYS)
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, provider_type):
        source = _source_label(provider)
        repos = db.scalars(select(Repo).where(Repo.provider_id == provider.id)).all()
        for repo in repos:
            self_merged = db.scalars(
                select(PullRequest).where(
                    PullRequest.repo_id == repo.id,
                    PullRequest.self_merge.is_(True),
                    PullRequest.merged_at >= cutoff,
                )
            ).all()
            if not self_merged:
                continue
            pr_nums = [pr.number for pr in self_merged]
            out.append(FindingDraft(
                check_id=check_id,
                resource_arn=f"{provider_type}://{source}/{repo.name}",
                title=f"Repository `{repo.name}` had {len(pr_nums)} self-merged PR(s) in the last 90 days",
                severity="high",
                risk_score=score("high"),
                evidence={
                    "provider_type": provider_type,
                    "source": source,
                    "repo": repo.name,
                    "self_merged_pr_numbers": pr_nums,
                    "count": len(pr_nums),
                    "window_days": DORMANT_DAYS,
                },
            ))
    return out


def run_no_env_protection(db: Session, account_id, provider_type: str, check_id: str) -> list[FindingDraft]:
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, provider_type):
        source = _source_label(provider)
        repos = db.scalars(select(Repo).where(Repo.provider_id == provider.id)).all()
        for repo in repos:
            envs = repo.protected_envs
            if not envs:
                continue
            unprotected = [e["name"] for e in envs if not e.get("has_required_reviewers")]
            if not unprotected:
                continue
            prod_like = [name for name in unprotected if _is_prod_like_env(name)]
            severity = "high" if prod_like else "medium"
            out.append(
                FindingDraft(
                    check_id=check_id,
                    resource_arn=f"{provider_type}://{source}/{repo.name}",
                    title=f"Repository `{repo.name}` has deployment environments with no required reviewers",
                    severity=severity,
                    risk_score=score(severity),
                    evidence={
                        "provider_type": provider_type,
                        "source": source,
                        "repo": repo.name,
                        "unprotected_environments": unprotected,
                        "prod_like_unprotected_environments": prod_like,
                        "all_environments": [e["name"] for e in envs],
                    },
                )
            )
    return out


def run_insufficient_reviews(db: Session, account_id, provider_type: str, check_id: str) -> list[FindingDraft]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=DORMANT_DAYS)
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, provider_type):
        source = _source_label(provider)
        repos = db.scalars(select(Repo).where(Repo.provider_id == provider.id)).all()
        for repo in repos:
            prs = db.scalars(
                select(PullRequest).where(
                    PullRequest.repo_id == repo.id,
                    PullRequest.merged_at >= cutoff,
                    PullRequest.merged_at.is_not(None),
                    PullRequest.required_review_count > 0,
                )
            ).all()
            under_reviewed = [pr for pr in prs if pr.approval_count < pr.required_review_count]
            if not under_reviewed:
                continue
            pr_nums = [pr.number for pr in under_reviewed]
            out.append(FindingDraft(
                check_id=check_id,
                resource_arn=f"{provider_type}://{source}/{repo.name}",
                title=f"Repository `{repo.name}` had {len(pr_nums)} PR(s) merged with insufficient approvals in the last 90 days",
                severity="high",
                risk_score=score("high"),
                evidence={
                    "provider_type": provider_type,
                    "source": source,
                    "repo": repo.name,
                    "under_reviewed_pr_numbers": pr_nums,
                    "count": len(pr_nums),
                    "window_days": DORMANT_DAYS,
                },
            ))
    return out
