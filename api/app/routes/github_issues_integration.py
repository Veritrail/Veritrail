"""Legacy GitHub Issues routes — delegate to IaC repository integration."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.route_deps import RequireAdmin
from app.core.security import current_principal
from app.routes import iac_repository_integration as iac_repo
from app.routes.iac_repository_integration import IacRepositoryIn

router = APIRouter()


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


def _legacy_out(data: iac_repo.IacRepositoryOut) -> GitHubIssuesOut:
    return GitHubIssuesOut(
        connected=data.connected,
        status=data.status,
        owner=data.owner,
        repo=data.repo,
        labels=data.labels,
        has_access_token=data.has_access_token,
    )


@router.get("/github-issues", response_model=GitHubIssuesOut)
def get_github_issues(p=Depends(current_principal), db: Session = Depends(get_db)):
    return _legacy_out(iac_repo.get_iac_repository(p=p, db=db))


@router.put("/github-issues", response_model=GitHubIssuesOut)
def put_github_issues(
    body: GitHubIssuesIn,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    payload = IacRepositoryIn(
        vcs_provider="github",
        owner=body.owner,
        repo=body.repo,
        access_token=body.access_token,
        labels=body.labels,
    )
    return _legacy_out(iac_repo.put_iac_repository(body=payload, _rbac=_rbac, p=p, db=db))


@router.delete("/github-issues", status_code=204)
def delete_github_issues(_rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    return iac_repo.delete_iac_repository(_rbac=_rbac, p=p, db=db)


@router.post("/github-issues/from-finding/{finding_id}", response_model=GitHubIssueOut)
def create_github_issue_from_finding(
    finding_id: uuid.UUID,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    created = iac_repo.create_remediation_ticket_from_finding(
        finding_id=finding_id,
        _rbac=_rbac,
        p=p,
        db=db,
    )
    return GitHubIssueOut(issue_key=created.issue_key, issue_url=created.issue_url)
