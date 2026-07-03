"""Azure Boards remediation ticketing integration."""
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
from app.services.azure_boards_client import AzureBoardsClient
from app.services.digest import _findings_app_url
from app.services.github_sync import provider_config, set_provider_config

router = APIRouter()
AZURE_BOARDS_TYPE = "azure_boards"


def _get_org(p, db: Session) -> Org:
    return resolve_org(db, p)


def _provider(db: Session, org_id: uuid.UUID) -> IdentityProvider | None:
    return db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == AZURE_BOARDS_TYPE,
        )
    )


class AzureBoardsOut(BaseModel):
    connected: bool
    status: str
    org_url: str | None = None
    project: str | None = None
    work_item_type: str = "Task"
    has_pat: bool = False


class AzureBoardsIn(BaseModel):
    org_url: str
    project: str
    pat: str | None = None
    work_item_type: str = "Task"


class AzureBoardsIssueOut(BaseModel):
    issue_key: str
    issue_url: str


@router.get("/azure-boards", response_model=AzureBoardsOut)
def get_azure_boards(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _provider(db, org.id)
    if not provider:
        return AzureBoardsOut(connected=False, status="not_configured")
    cfg = provider_config(provider)
    return AzureBoardsOut(
        connected=True,
        status=provider.status,
        org_url=cfg.get("org_url"),
        project=cfg.get("project"),
        work_item_type=cfg.get("work_item_type") or "Task",
        has_pat=bool(cfg.get("pat")),
    )


@router.put("/azure-boards", response_model=AzureBoardsOut)
def put_azure_boards(
    body: AzureBoardsIn,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    provider = _provider(db, org.id)
    existing = provider_config(provider) if provider else {}
    pat = (body.pat or "").strip() or existing.get("pat")
    if not pat:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Azure DevOps PAT is required")
    config = {
        **existing,
        "org_url": body.org_url.strip().rstrip("/"),
        "project": body.project.strip(),
        "pat": pat,
        "work_item_type": (body.work_item_type or "Task").strip() or "Task",
    }
    try:
        AzureBoardsClient(org_url=config["org_url"], pat=pat).verify(config["project"])
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Azure Boards verify failed: {e}") from e

    if not provider:
        provider = IdentityProvider(org_id=org.id, type=AZURE_BOARDS_TYPE, status="connected")
        db.add(provider)
    set_provider_config(provider, config)
    provider.status = "connected"
    db.commit()
    db.refresh(provider)
    return get_azure_boards(p=p, db=db)


@router.delete("/azure-boards", status_code=204)
def delete_azure_boards(_rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = _provider(db, org.id)
    if provider:
        db.delete(provider)
        db.commit()


@router.post("/azure-boards/from-finding/{finding_id}", response_model=AzureBoardsIssueOut)
def create_azure_boards_item_from_finding(
    finding_id: uuid.UUID,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    provider = _provider(db, org.id)
    if not provider or provider.status != "connected":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Azure Boards is not connected")

    finding = db.get(Finding, finding_id)
    if not finding or finding.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding not found")

    cfg = provider_config(provider)
    if finding.remediation_ticket_key and finding.remediation_ticket_url:
        return AzureBoardsIssueOut(issue_key=finding.remediation_ticket_key, issue_url=finding.remediation_ticket_url)

    existing = (finding.evidence or {}).get("azure_boards")
    if isinstance(existing, dict) and existing.get("issue_key"):
        finding.remediation_ticket_key = existing["issue_key"]
        finding.remediation_ticket_url = existing.get("issue_url")
        db.commit()
        return AzureBoardsIssueOut(issue_key=existing["issue_key"], issue_url=existing["issue_url"])

    app_url = _findings_app_url().rstrip("/")
    finding_url = f"{app_url}/findings?finding={finding.id}"
    description = (
        f"Severity: {finding.severity.upper()}<br>"
        f"Check: {finding.check_id}<br>"
        f"Resource: {finding.resource_arn}<br><br>"
        f"<a href=\"{finding_url}\">View in Veritrail</a>"
    )
    try:
        created = AzureBoardsClient(org_url=cfg["org_url"], pat=cfg["pat"]).create_work_item(
            project=cfg["project"],
            title=finding.title,
            description=description,
            work_item_type=cfg.get("work_item_type") or "Task",
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Azure Boards create failed: {e}") from e

    evidence = dict(finding.evidence or {})
    evidence["azure_boards"] = created
    finding.evidence = evidence
    flag_modified(finding, "evidence")
    finding.remediation_ticket_key = created["issue_key"]
    finding.remediation_ticket_url = created["issue_url"]
    db.add(FindingEvent(id=uuid.uuid4(), finding_id=finding.id, action="note", note=f"Azure Boards {created['issue_key']}"))
    db.commit()
    return AzureBoardsIssueOut(**created)
