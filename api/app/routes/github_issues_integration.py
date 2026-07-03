"""GitHub Issues remediation ticketing integration."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.db import get_db
from app.core.org_context import resolve_org
from app.core.route_deps import RequireAdmin
from app.core.security import current_principal
from app.models.finding import Finding, FindingEvent
from app.models.github import IdentityProvider
from app.models.org import Org
from app.services.digest import _findings_app_url
from app.services.github_issues_client import GitHubIssuesClient, normalize_github_repo_ref
from app.services.github_sync import provider_config, set_provider_config

router = APIRouter()
GITHUB_ISSUES_TYPE = "github_issues"
GITHUB_TYPE = "github"


def _get_org(p, db: Session) -> Org:
    return resolve_org(db, p)


def _issues_provider(db: Session, org_id: uuid.UUID) -> IdentityProvider | None:
    return db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == GITHUB_ISSUES_TYPE,
        )
    )


def _github_provider(db: Session, org_id: uuid.UUID) -> IdentityProvider | None:
    return db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == GITHUB_TYPE,
        )
    )


def _resolve_token(db: Session, org_id: uuid.UUID, cfg: dict) -> str:
    token = (cfg.get("access_token") or "").strip()
    if token:
        return token
    gh = _github_provider(db, org_id)
    if gh:
        gh_cfg = provider_config(gh)
        token = (gh_cfg.get("access_token") or "").strip()
    if not token:
        raise ValueError("Connect GitHub or provide a dedicated access_token for Issues")
    return token


class GitHubIssuesOut(BaseModel):
    connected: bool
    status: str
    owner: str | None = None
    repo: str | None = None
    labels: list[str] = []
    has_access_token: bool = False


class GitHubIssuesIn(BaseModel):
    owner: str
    repo: str
    access_token: str | None = None
    labels: list[str] | None = None


class GitHubIssueOut(BaseModel):
    issue_key: str
    issue_url: str


@router.get("/github-issues", response_model=GitHubIssuesOut)
def get_github_issues(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _issues_provider(db, org.id)
    if not provider:
        return GitHubIssuesOut(connected=False, status="not_configured")
    cfg = provider_config(provider)
    return GitHubIssuesOut(
        connected=True,
        status=provider.status,
        owner=cfg.get("owner"),
        repo=cfg.get("repo"),
        labels=cfg.get("labels") or [],
        has_access_token=bool(cfg.get("access_token")),
    )


@router.put("/github-issues", response_model=GitHubIssuesOut)
def put_github_issues(
    body: GitHubIssuesIn,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    provider = _issues_provider(db, org.id)
    existing = provider_config(provider) if provider else {}
    config = dict(existing)
    owner, repo = normalize_github_repo_ref(body.owner, body.repo)
    config["owner"] = owner
    config["repo"] = repo
    if body.labels is not None:
        config["labels"] = [label.strip() for label in body.labels if label.strip()]
    if body.access_token and body.access_token.strip():
        config["access_token"] = body.access_token.strip()
    try:
        token = _resolve_token(db, org.id, config)
        GitHubIssuesClient(token=token).verify(config["owner"], config["repo"])
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"GitHub Issues verify failed: {e}") from e

    if not provider:
        provider = IdentityProvider(org_id=org.id, type=GITHUB_ISSUES_TYPE, status="connected")
        db.add(provider)
    set_provider_config(provider, config)
    provider.status = "connected"
    db.commit()
    db.refresh(provider)
    return get_github_issues(p=p, db=db)


@router.delete("/github-issues", status_code=204)
def delete_github_issues(_rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _issues_provider(db, org.id)
    if provider:
        db.delete(provider)
        db.commit()


@router.post("/github-issues/from-finding/{finding_id}", response_model=GitHubIssueOut)
def create_github_issue_from_finding(
    finding_id: uuid.UUID,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    provider = _issues_provider(db, org.id)
    if not provider or provider.status != "connected":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "GitHub Issues is not connected")

    finding = db.get(Finding, finding_id)
    if not finding or finding.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding not found")

    cfg = provider_config(provider)
    if finding.remediation_ticket_key and finding.remediation_ticket_url:
        return GitHubIssueOut(issue_key=finding.remediation_ticket_key, issue_url=finding.remediation_ticket_url)

    existing = (finding.evidence or {}).get("github_issue")
    if isinstance(existing, dict) and existing.get("issue_key"):
        finding.remediation_ticket_key = existing["issue_key"]
        finding.remediation_ticket_url = existing.get("issue_url")
        db.commit()
        return GitHubIssueOut(issue_key=existing["issue_key"], issue_url=existing["issue_url"])

    app_url = _findings_app_url().rstrip("/")
    finding_url = f"{app_url}/findings?finding={finding.id}"
    description = (
        f"Severity: {finding.severity.upper()}\n"
        f"Check: {finding.check_id}\n"
        f"Resource: {finding.resource_arn}\n\n"
        f"View in Veritrail: {finding_url}"
    )
    try:
        token = _resolve_token(db, org.id, cfg)
        created = GitHubIssuesClient(token=token).create_issue(
            owner=cfg["owner"],
            repo=cfg["repo"],
            title=finding.title,
            body=description,
            labels=cfg.get("labels") or None,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"GitHub issue create failed: {e}") from e

    evidence = dict(finding.evidence or {})
    evidence["github_issue"] = created
    finding.evidence = evidence
    flag_modified(finding, "evidence")
    finding.remediation_ticket_key = created["issue_key"]
    finding.remediation_ticket_url = created["issue_url"]
    db.add(FindingEvent(id=uuid.uuid4(), finding_id=finding.id, action="note", note=f"GitHub issue {created['issue_key']}"))
    db.commit()
    return GitHubIssueOut(**created)
