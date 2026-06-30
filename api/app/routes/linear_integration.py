"""Linear integration — store credentials encrypted and collect issue evidence.

Mirrors the Jira integration: credentials live in ``IdentityProvider`` with the
``config_json_encrypted`` column (Fernet-encrypted at rest), every route is
RBAC-guarded, and the raw token is never returned to clients.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.org_context import resolve_org
from app.core.route_deps import RequireAdmin, RequireViewer
from app.core.security import current_principal
from app.models.github import IdentityProvider
from app.models.org import Org
from app.services.github_sync import provider_config, set_provider_config
from app.services.linear_client import LinearClient

router = APIRouter()
LINEAR_TYPE = "linear"


def _get_org(p, db: Session) -> Org:
    return resolve_org(db, p)


def _linear_provider(db: Session, org_id: uuid.UUID) -> IdentityProvider | None:
    return db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == LINEAR_TYPE,
        )
    )


def _public_config(cfg: dict) -> dict:
    return {
        "workspace_user": cfg.get("display_name"),
        "email": cfg.get("email"),
        "has_api_key": bool(cfg.get("api_key")),
        "team_id": cfg.get("team_id"),
    }


class LinearIntegrationOut(BaseModel):
    connected: bool
    status: str
    workspace_user: str | None = None
    email: str | None = None
    has_api_key: bool = False
    team_id: str | None = None


class LinearIntegrationIn(BaseModel):
    api_key: str | None = None
    team_id: str | None = None


class LinearIssueCreateOut(BaseModel):
    issue_key: str
    issue_url: str


class LinearIssueOut(BaseModel):
    identifier: str | None = None
    title: str | None = None
    url: str | None = None
    state: str | None = None
    assignee: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    labels: list[str] = []


@router.get("/linear", response_model=LinearIntegrationOut)
def get_linear(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _linear_provider(db, org.id)
    if not provider:
        return LinearIntegrationOut(connected=False, status="not_configured")
    pub = _public_config(provider_config(provider))
    return LinearIntegrationOut(
        connected=True,
        status=provider.status,
        workspace_user=pub["workspace_user"],
        email=pub["email"],
        has_api_key=pub["has_api_key"],
        team_id=pub.get("team_id"),
    )


@router.put("/linear", response_model=LinearIntegrationOut)
def put_linear(body: LinearIntegrationIn, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _linear_provider(db, org.id)
    existing = provider_config(provider) if provider else {}

    api_key = (body.api_key or "").strip() or existing.get("api_key")
    if not api_key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Linear API key is required")

    try:
        identity = LinearClient(api_key=api_key).verify()
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not verify Linear connection: {e}") from e

    config = {
        "api_key": api_key,
        "email": identity.get("email"),
        "display_name": identity.get("display_name"),
        "user_id": identity.get("user_id"),
    }
    if body.team_id:
        config["team_id"] = body.team_id.strip()
    elif existing.get("team_id"):
        config["team_id"] = existing["team_id"]

    if not provider:
        provider = IdentityProvider(org_id=org.id, type=LINEAR_TYPE, status="connected")
        db.add(provider)
    set_provider_config(provider, config)
    provider.status = "connected"
    db.commit()
    db.refresh(provider)
    return get_linear(p=p, db=db)


@router.post("/linear/test")
def test_linear(_rbac: RequireAdmin, body: LinearIntegrationIn = LinearIntegrationIn(), p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _linear_provider(db, org.id)
    cfg = provider_config(provider) if provider else {}

    api_key = (body.api_key or "").strip() or cfg.get("api_key")
    if not api_key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Provide a Linear API key before testing")

    try:
        identity = LinearClient(api_key=api_key).verify()
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Linear test failed: {e}") from e

    return {"ok": True, **identity}


@router.delete("/linear", status_code=204)
def delete_linear(_rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _linear_provider(db, org.id)
    if provider:
        db.delete(provider)
        db.commit()


@router.get("/linear/issues", response_model=list[LinearIssueOut])
def list_linear_issues(_rbac: RequireViewer, first: int = 50, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _linear_provider(db, org.id)
    if not provider or provider.status != "connected":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Linear is not connected")

    cfg = provider_config(provider)
    api_key = cfg.get("api_key")
    if not api_key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Linear is not connected")

    try:
        rows = LinearClient(api_key=api_key).list_issues(first=first)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Failed to fetch Linear issues: {e}") from e

    return [LinearIssueOut(**row) for row in rows]


@router.post("/linear/issues/from-finding/{finding_id}", response_model=LinearIssueCreateOut)
def create_linear_issue_from_finding(
    finding_id: uuid.UUID,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    from app.models.finding import Finding, FindingEvent
    from app.services.digest import _findings_app_url
    from sqlalchemy.orm.attributes import flag_modified

    org = _get_org(p, db)
    provider = _linear_provider(db, org.id)
    if not provider or provider.status != "connected":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Linear is not connected")

    finding = db.get(Finding, finding_id)
    if not finding or finding.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding not found")

    cfg = provider_config(provider)
    team_id = (cfg.get("team_id") or "").strip()
    if not team_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Configure a Linear team_id before creating issues")

    if finding.remediation_ticket_key and finding.remediation_ticket_url:
        return LinearIssueCreateOut(
            issue_key=finding.remediation_ticket_key,
            issue_url=finding.remediation_ticket_url,
        )

    existing = (finding.evidence or {}).get("linear")
    if isinstance(existing, dict) and existing.get("issue_key"):
        finding.remediation_ticket_key = existing["issue_key"]
        finding.remediation_ticket_url = existing.get("issue_url")
        db.commit()
        return LinearIssueCreateOut(issue_key=existing["issue_key"], issue_url=existing["issue_url"])

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
        created = LinearClient(api_key=cfg["api_key"]).create_issue(
            team_id=team_id,
            title=f"[Veritrail] {finding.title}",
            description=description,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Failed to create Linear issue: {e}") from e

    evidence = dict(finding.evidence or {})
    evidence["linear"] = created
    finding.evidence = evidence
    finding.remediation_ticket_key = created["issue_key"]
    finding.remediation_ticket_url = created["issue_url"]
    flag_modified(finding, "evidence")
    db.add(
        FindingEvent(
            finding_id=finding.id,
            actor=p.get("email") or "user",
            action="note",
            note=f"Linear issue created: {created['issue_key']}",
        )
    )
    db.commit()
    return LinearIssueCreateOut(issue_key=created["issue_key"], issue_url=created["issue_url"])
