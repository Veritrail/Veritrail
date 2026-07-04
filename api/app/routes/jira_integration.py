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
from app.models.org import Org, User
from app.services.digest import _findings_app_url
from app.services.user_display_name import resolve_user_display_name
from app.services.jira_client import JiraClient, normalize_site_url
from app.services.jira_issue_summary import build_jira_issue_summary
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
    pub = {
        "site_url": cfg.get("site_url"),
        "email": cfg.get("email"),
        "project_key": cfg.get("project_key"),
        "has_api_token": bool(cfg.get("api_token")),
    }
    legacy_issue_type = (cfg.get("issue_type") or "").strip()
    if legacy_issue_type:
        pub["issue_type"] = legacy_issue_type
    return pub


class JiraIntegrationOut(BaseModel):
    connected: bool
    status: str
    site_url: str | None = None
    email: str | None = None
    project_key: str | None = None
    issue_type: str | None = None
    has_api_token: bool = False


class JiraIntegrationIn(BaseModel):
    site_url: str
    email: str
    api_token: str | None = None
    project_key: str | None = None
    issue_type: str | None = None  # ignored; kept for backward-compatible clients


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


class JiraIssueTypeOut(BaseModel):
    id: str
    name: str
    subtask: bool = False
    is_default: bool = False
    icon_url: str | None = None


class JiraIssueCreateIn(BaseModel):
    summary: str | None = None
    priority: str | None = None
    assignee_account_id: str | None = None
    labels: list[str] | None = None
    project_key: str | None = None
    issue_type: str | None = None


class JiraIssueStatusOut(BaseModel):
    issue_key: str
    status: str
    status_category: str
    is_done: bool
    synced_at: datetime


def _finding_jira_issue(finding: Finding) -> dict | None:
    jira = (finding.evidence or {}).get("jira")
    if isinstance(jira, dict) and jira.get("issue_key"):
        return jira
    if finding.remediation_ticket_key and finding.remediation_ticket_url:
        ticket_url = finding.remediation_ticket_url.lower()
        if "atlassian.net" in ticket_url or "/browse/" in ticket_url:
            return {
                "issue_key": finding.remediation_ticket_key,
                "issue_url": finding.remediation_ticket_url,
            }
    return None


def _recommended_remediation(finding: Finding) -> str:
    if finding.check_id.startswith("iam.role") and "least_privilege" in finding.check_id:
        return (
            "Scope this IAM role to the permissions observed in use. "
            "Remove wildcard Action:* and Resource:* permissions unless they are explicitly required and approved."
        )
    if "least_privilege" in finding.check_id:
        return (
            "Scope this resource to the permissions observed in use. "
            "Remove wildcard permissions unless they are explicitly required and approved."
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
        f"Opened by: {actor}\n"
        f"Opened at: {opened_at}\n"
        f"Account: {account_label}\n\n"
        f"Severity: {finding.severity.upper()} · Risk score {finding.risk_score}\n"
        f"Check: {finding.check_id}\n"
        f"Resource: {finding.resource_arn}\n\n"
        "Recommended remediation\n"
        f"{_recommended_remediation(finding)}\n\n"
        "Verification\n"
        "After remediation, return to Veritrail and run Verify fix. "
        "Close this issue only after verification passes.\n\n"
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


@router.get("/jira/projects/{project_key}/issue-types", response_model=list[JiraIssueTypeOut])
def list_jira_project_issue_types(
    project_key: str,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    provider = _jira_provider(db, org.id)
    if not provider or provider.status != "connected":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Jira is not connected")

    key = project_key.strip().upper()
    if not key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Jira project key is required")

    cfg = provider_config(provider)
    try:
        issue_types = JiraClient(
            site_url=cfg["site_url"],
            email=cfg["email"],
            api_token=cfg["api_token"],
        ).list_issue_types(project_key=key)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Failed to list Jira issue types: {e}") from e
    return [JiraIssueTypeOut(**issue_type) for issue_type in issue_types]


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
        issue_type=pub.get("issue_type"),
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

    incoming_project_key = (body.project_key or "").strip().upper()
    existing_project_key = (existing.get("project_key") or "").strip().upper()
    resolved_project_key = incoming_project_key or existing_project_key or None

    try:
        site_url = normalize_site_url(body.site_url)
        client = JiraClient(site_url=site_url, email=body.email, api_token=api_token)
        client.verify(resolved_project_key)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not verify Jira connection: {e}") from e

    config = {
        "site_url": site_url,
        "email": body.email.strip(),
        "api_token": api_token,
    }
    if resolved_project_key:
        config["project_key"] = resolved_project_key
    legacy_issue_type = (existing.get("issue_type") or "").strip()
    if legacy_issue_type:
        config["issue_type"] = legacy_issue_type

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

    if not all([site_url, email, api_token]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Complete Jira connection details before testing")

    try:
        client = JiraClient(site_url=site_url, email=email, api_token=api_token)
        result = client.verify(project_key or None)
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


@router.post("/jira/issues/sync-from-finding/{finding_id}", response_model=JiraIssueStatusOut)
def sync_jira_issue_from_finding(
    finding_id: uuid.UUID,
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

    jira_issue = _finding_jira_issue(finding)
    if not jira_issue or not jira_issue.get("issue_key"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding has no linked Jira issue")

    cfg = provider_config(provider)
    try:
        fetched = JiraClient(
            site_url=cfg["site_url"],
            email=cfg["email"],
            api_token=cfg["api_token"],
        ).get_issue_status(jira_issue["issue_key"])
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Failed to fetch Jira issue status: {e}") from e

    synced_at = datetime.now(UTC)
    status_category = fetched.get("status_category", "")
    is_done = status_category == "done"

    # Re-read the finding so a concurrent unlink cannot be overwritten by stale status sync.
    db.refresh(finding)
    current = _finding_jira_issue(finding)
    if not current or current.get("issue_key") != jira_issue.get("issue_key"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding has no linked Jira issue")

    evidence = dict(finding.evidence or {})
    stored = dict(current)
    stored["issue_key"] = fetched["issue_key"]
    stored["status"] = fetched.get("status", "")
    stored["status_category"] = status_category
    stored["status_synced_at"] = synced_at.isoformat()
    evidence["jira"] = stored
    finding.evidence = evidence
    flag_modified(finding, "evidence")
    db.commit()

    return JiraIssueStatusOut(
        issue_key=fetched["issue_key"],
        status=fetched.get("status", ""),
        status_category=status_category,
        is_done=is_done,
        synced_at=synced_at,
    )


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

    if finding.remediation_ticket_key and finding.remediation_ticket_url:
        jira_evidence = (finding.evidence or {}).get("jira")
        if isinstance(jira_evidence, dict) and jira_evidence.get("issue_key"):
            return JiraIssueOut(
                issue_key=jira_evidence["issue_key"],
                issue_url=jira_evidence.get("issue_url") or finding.remediation_ticket_url,
            )
        ticket_url = finding.remediation_ticket_url.lower()
        if "atlassian.net" in ticket_url or "/browse/" in ticket_url:
            return JiraIssueOut(
                issue_key=finding.remediation_ticket_key,
                issue_url=finding.remediation_ticket_url,
            )
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Finding already has a remediation ticket",
        )

    existing = (finding.evidence or {}).get("jira")
    if isinstance(existing, dict) and existing.get("issue_key"):
        if not finding.remediation_ticket_key:
            finding.remediation_ticket_key = existing["issue_key"]
            finding.remediation_ticket_url = existing.get("issue_url")
            db.commit()
        return JiraIssueOut(issue_key=existing["issue_key"], issue_url=existing["issue_url"])

    app_url = _findings_app_url().rstrip("/")
    finding_url = f"{app_url}/findings?finding={finding.id}"
    actor_user = db.get(User, uuid.UUID(p["sub"]))
    actor = resolve_user_display_name(actor_user) if actor_user else "user"
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
    if "least_privilege" in finding.check_id and "least-privilege" not in labels:
        labels.append("least-privilege")
    priority = body.priority.strip() if body.priority else None
    assignee_account_id = body.assignee_account_id.strip() if body.assignee_account_id else None
    project_key = (body.project_key or cfg.get("project_key") or "").strip().upper()
    if not project_key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Jira project key is required")
    issue_type = (body.issue_type or "").strip() or "Task"
    summary = (
        body.summary.strip()
        if body.summary and body.summary.strip()
        else build_jira_issue_summary(
            check_id=finding.check_id,
            resource_arn=finding.resource_arn,
            title=finding.title,
        )
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
            issue_type=issue_type,
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
