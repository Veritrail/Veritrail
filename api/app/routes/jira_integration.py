"""Jira Cloud ticketing integration (create issues from findings)."""
from __future__ import annotations

import json
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
from app.services.jira_client import JiraClient, normalize_site_url
from app.services.github_sync import provider_config, set_provider_config

router = APIRouter()
JIRA_TYPE = "jira"


def _get_org(p, db: Session) -> Org:
    return resolve_org(db, p)


def _jira_provider(db: Session, org_id: uuid.UUID) -> IdentityProvider | None:
    return db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == JIRA_TYPE,
        )
    )


def _public_config(cfg: dict) -> dict:
    return {
        "site_url": cfg.get("site_url"),
        "email": cfg.get("email"),
        "project_key": cfg.get("project_key"),
        "issue_type": cfg.get("issue_type") or "Task",
        "has_api_token": bool(cfg.get("api_token")),
    }


class JiraIntegrationOut(BaseModel):
    connected: bool
    status: str
    site_url: str | None = None
    email: str | None = None
    project_key: str | None = None
    issue_type: str = "Task"
    has_api_token: bool = False


class JiraIntegrationIn(BaseModel):
    site_url: str
    email: str
    api_token: str | None = None
    project_key: str
    issue_type: str = "Task"


class JiraTestIn(BaseModel):
    site_url: str | None = None
    email: str | None = None
    api_token: str | None = None
    project_key: str | None = None


class JiraIssueOut(BaseModel):
    issue_key: str
    issue_url: str


@router.get("/jira", response_model=JiraIntegrationOut)
def get_jira(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _jira_provider(db, org.id)
    if not provider:
        return JiraIntegrationOut(connected=False, status="not_configured")
    cfg = provider_config(provider)
    pub = _public_config(cfg)
    return JiraIntegrationOut(
        connected=True,
        status=provider.status,
        site_url=pub["site_url"],
        email=pub["email"],
        project_key=pub["project_key"],
        issue_type=pub["issue_type"],
        has_api_token=pub["has_api_token"],
    )


@router.put("/jira", response_model=JiraIntegrationOut)
def put_jira(body: JiraIntegrationIn, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _jira_provider(db, org.id)
    existing = provider_config(provider) if provider else {}

    api_token = (body.api_token or "").strip() or existing.get("api_token")
    if not api_token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Jira API token is required")

    try:
        site_url = normalize_site_url(body.site_url)
        client = JiraClient(site_url=site_url, email=body.email, api_token=api_token)
        client.verify(body.project_key)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not verify Jira connection: {e}") from e

    config = {
        "site_url": site_url,
        "email": body.email.strip(),
        "api_token": api_token,
        "project_key": body.project_key.strip().upper(),
        "issue_type": (body.issue_type or "Task").strip() or "Task",
    }

    if not provider:
        provider = IdentityProvider(org_id=org.id, type=JIRA_TYPE, status="connected")
        db.add(provider)
    set_provider_config(provider, config)
    provider.status = "connected"
    db.commit()
    db.refresh(provider)
    return get_jira(p=p, db=db)


@router.post("/jira/test")
def test_jira(_rbac: RequireAdmin, body: JiraTestIn = JiraTestIn(), p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _jira_provider(db, org.id)
    cfg = provider_config(provider) if provider else {}

    site_url = body.site_url or cfg.get("site_url")
    email = body.email or cfg.get("email")
    api_token = body.api_token or cfg.get("api_token")
    project_key = body.project_key or cfg.get("project_key")

    if not all([site_url, email, api_token, project_key]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Complete Jira connection details before testing")

    try:
        client = JiraClient(site_url=site_url, email=email, api_token=api_token)
        result = client.verify(project_key)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Jira test failed: {e}") from e

    return {"ok": True, **result}


@router.delete("/jira", status_code=204)
def delete_jira(_rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _jira_provider(db, org.id)
    if provider:
        db.delete(provider)
        db.commit()


@router.post("/jira/issues/from-finding/{finding_id}", response_model=JiraIssueOut)
def create_issue_from_finding(
    finding_id: uuid.UUID,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    provider = _jira_provider(db, org.id)
    if not provider or provider.status != "connected":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Jira is not connected")

    finding = db.get(Finding, finding_id)
    if not finding or finding.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding not found")

    cfg = provider_config(provider)
    existing = (finding.evidence or {}).get("jira")
    if isinstance(existing, dict) and existing.get("issue_key"):
        if not finding.remediation_ticket_key:
            finding.remediation_ticket_key = existing["issue_key"]
            finding.remediation_ticket_url = existing.get("issue_url")
            db.commit()
        return JiraIssueOut(issue_key=existing["issue_key"], issue_url=existing["issue_url"])

    app_url = _findings_app_url().rstrip("/")
    finding_url = f"{app_url}/findings?finding={finding.id}"
    description = (
        f"Severity: {finding.severity.upper()}\n"
        f"Check: {finding.check_id}\n"
        f"Resource: {finding.resource_arn}\n"
        f"Risk score: {finding.risk_score}\n\n"
        f"Open in Veritrail: {finding_url}"
    )

    try:
        client = JiraClient(
            site_url=cfg["site_url"],
            email=cfg["email"],
            api_token=cfg["api_token"],
        )
        created = client.create_issue(
            project_key=cfg["project_key"],
            summary=f"[Veritrail] {finding.title}"[:255],
            description=description,
            issue_type=cfg.get("issue_type") or "Task",
            labels=["veritrail", finding.severity],
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Failed to create Jira issue: {e}") from e

    evidence = dict(finding.evidence or {})
    evidence["jira"] = created
    finding.evidence = evidence
    finding.remediation_ticket_key = created["issue_key"]
    finding.remediation_ticket_url = created["issue_url"]
    flag_modified(finding, "evidence")
    db.add(
        FindingEvent(
            finding_id=finding.id,
            actor=p.get("email") or "user",
            action="note",
            note=f"Jira issue created: {created['issue_key']}",
        )
    )
    db.commit()

    return JiraIssueOut(**created)
