"""Jira Cloud ticketing integration (create issues from findings)."""
from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.db import get_db
from app.core.org_context import resolve_org
from app.core.route_deps import RequireAdmin
from app.core.security import current_principal
from app.models.aws_account import AwsAccount
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


class JiraUserOut(BaseModel):
    account_id: str
    display_name: str
    email: str = ""
    avatar_url: str = ""


class JiraProjectOut(BaseModel):
    key: str
    name: str
    id: str = ""


class JiraIssueCreateIn(BaseModel):
    summary: str | None = None
    priority: str | None = None
    assignee_account_id: str | None = None
    labels: list[str] | None = None
    project_key: str | None = None


def _resource_name(resource_arn: str) -> str:
    value = (resource_arn or "").strip()
    if not value:
        return "Affected resource"
    return value.rsplit("/", 1)[-1].rsplit(":", 1)[-1] or value


def _recommended_remediation(finding: Finding) -> str:
    if "least_privilege" in finding.check_id:
        return (
            "Replace broad IAM permissions with least-privilege policies scoped to observed usage. "
            "Remove wildcard Action:* and Resource:* access unless it is explicitly required and approved."
        )
    if "mfa" in finding.check_id:
        return "Enable MFA for the affected identity, then re-scan the account to confirm the finding is resolved."
    if "logging" in finding.check_id or "cloudtrail" in finding.check_id:
        return "Enable the missing logging coverage, verify events are being collected, then re-scan in Veritrail."
    return "Apply the remediation guidance in Veritrail, then verify the fix from the finding drawer."


def _issue_description(
    *,
    finding: Finding,
    finding_url: str,
    account: AwsAccount | None,
    actor: str,
) -> str:
    account_label = "Unknown account"
    if account:
        account_label = f"{account.label or 'AWS account'} ({account.account_id or 'unknown'})"

    opened_at = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    return (
        "Opened from Veritrail\n"
        f"Opened by: {actor}\n"
        f"Opened at: {opened_at}\n"
        f"Account: {account_label}\n"
        f"Severity: {finding.severity.upper()} · Risk score: {finding.risk_score}\n"
        f"Check: {finding.check_id}\n"
        f"Resource: {finding.resource_arn}\n\n"
        "Recommended remediation\n"
        f"{_recommended_remediation(finding)}\n\n"
        "Why this matters\n"
        "This finding is currently open in Veritrail and may expose the account to unnecessary access, "
        "audit evidence gaps, or remediation drift until it is fixed and verified.\n\n"
        "Verification\n"
        "After the change is applied, return to the finding in Veritrail and run Verify fix. "
        "Keep this ticket open until Veritrail confirms the finding is resolved.\n\n"
        f"Open finding in Veritrail: {finding_url}"
    )


@router.get("/jira/projects", response_model=list[JiraProjectOut])
def list_jira_projects(
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    provider = _jira_provider(db, org.id)
    if not provider or provider.status != "connected":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Jira is not connected")

    cfg = provider_config(provider)
    try:
        projects = JiraClient(
            site_url=cfg["site_url"],
            email=cfg["email"],
            api_token=cfg["api_token"],
        ).list_projects()
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Failed to list Jira projects: {e}") from e
    return [JiraProjectOut(**project) for project in projects]


@router.get("/jira/assignable-users", response_model=list[JiraUserOut])
def search_jira_assignable_users(
    _rbac: RequireAdmin,
    query: str = Query(default=""),
    project: str | None = Query(default=None),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    provider = _jira_provider(db, org.id)
    if not provider or provider.status != "connected":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Jira is not connected")

    cfg = provider_config(provider)
    project_key = (project or cfg.get("project_key") or "").strip().upper()
    if not project_key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Jira project key is required")
    try:
        users = JiraClient(
            site_url=cfg["site_url"],
            email=cfg["email"],
            api_token=cfg["api_token"],
        ).search_assignable_users(project_key=project_key, query=query)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Failed to search Jira users: {e}") from e
    return [JiraUserOut(**user) for user in users]


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
    body: JiraIssueCreateIn = JiraIssueCreateIn(),
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
    actor = p.get("email") or "user"
    account = db.get(AwsAccount, finding.account_id) if finding.account_id else None
    description = _issue_description(
        finding=finding,
        finding_url=finding_url,
        account=account,
        actor=actor,
    )
    labels = body.labels or ["veritrail", finding.severity]
    labels = [label.strip().lower().replace(" ", "-") for label in labels if label and label.strip()]
    if "veritrail" not in labels:
        labels.insert(0, "veritrail")
    if finding.severity not in labels:
        labels.append(finding.severity)
    priority = body.priority.strip() if body.priority else None
    assignee_account_id = body.assignee_account_id.strip() if body.assignee_account_id else None
    project_key = (body.project_key or cfg.get("project_key") or "").strip().upper()
    if not project_key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Jira project key is required")
    summary = (
        body.summary.strip()
        if body.summary and body.summary.strip()
        else f"[Veritrail] {_resource_name(finding.resource_arn)} — {finding.title}"
    )

    try:
        client = JiraClient(
            site_url=cfg["site_url"],
            email=cfg["email"],
            api_token=cfg["api_token"],
        )
        created = client.create_issue(
            project_key=project_key,
            summary=summary[:255],
            description=description,
            issue_type=cfg.get("issue_type") or "Task",
            labels=labels,
            priority=priority,
            assignee_account_id=assignee_account_id,
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
            actor=actor,
            action="note",
            note=f"Jira issue created: {created['issue_key']}",
        )
    )
    db.commit()

    return JiraIssueOut(**created)
