"""GCP project integration routes."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.route_deps import RequireAdmin
from app.core.security import current_principal
from app.models.gcp_project import GcpProject
from app.models.org import Org
from app.services.gcp_client import GcpClient

router = APIRouter()


def _get_org(p, db: Session) -> Org:
    org = db.get(Org, uuid.UUID(p["org_id"]))
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    return org


class GcpProjectOut(BaseModel):
    id: str
    project_id: str
    label: str
    status: str
    last_scan_at: str | None = None
    last_error: str | None = None
    has_service_account: bool = True

    class Config:
        from_attributes = True


class GcpProjectIn(BaseModel):
    project_id: str
    label: str = ""
    service_account_json: str | None = None


class GcpProjectPatch(BaseModel):
    label: str | None = None
    service_account_json: str | None = None
    status: str | None = None


def _to_out(row: GcpProject) -> GcpProjectOut:
    return GcpProjectOut(
        id=str(row.id),
        project_id=row.project_id,
        label=row.label or row.project_id,
        status=row.status,
        last_scan_at=row.last_scan_at.isoformat() if row.last_scan_at else None,
        last_error=row.last_error,
        has_service_account=bool(row.service_account_json),
    )


@router.get("/gcp/projects", response_model=list[GcpProjectOut])
def list_gcp_projects(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    rows = db.scalars(select(GcpProject).where(GcpProject.org_id == org.id).order_by(GcpProject.project_id)).all()
    return [_to_out(r) for r in rows]


@router.post("/gcp/projects", response_model=GcpProjectOut, status_code=201)
def create_gcp_project(body: GcpProjectIn, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    pid = body.project_id.strip()
    if not pid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "project_id is required")
    sa_json = (body.service_account_json or "").strip()
    if not sa_json:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "service_account_json is required")

    existing = db.scalar(
        select(GcpProject).where(GcpProject.org_id == org.id, GcpProject.project_id == pid)
    )
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "GCP project already connected")

    row = GcpProject(
        org_id=org.id,
        project_id=pid,
        label=(body.label or pid).strip(),
        service_account_json=sa_json,
        status="pending",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.patch("/gcp/projects/{project_row_id}", response_model=GcpProjectOut)
def patch_gcp_project(
    project_row_id: uuid.UUID,
    body: GcpProjectPatch,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    row = db.get(GcpProject, project_row_id)
    if not row or row.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "GCP project not found")
    if body.label is not None:
        row.label = body.label.strip()
    if body.service_account_json is not None and body.service_account_json.strip():
        row.service_account_json = body.service_account_json.strip()
    if body.status is not None:
        row.status = body.status.strip()
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.delete("/gcp/projects/{project_row_id}", status_code=204)
def delete_gcp_project(
    project_row_id: uuid.UUID,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    row = db.get(GcpProject, project_row_id)
    if not row or row.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "GCP project not found")
    db.delete(row)
    db.commit()


@router.post("/gcp/projects/{project_row_id}/verify")
def verify_gcp_project(
    project_row_id: uuid.UUID,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    row = db.get(GcpProject, project_row_id)
    if not row or row.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "GCP project not found")
    try:
        result = GcpClient(row.service_account_json).verify(row.project_id)
    except ValueError as e:
        row.status = "error"
        row.last_error = str(e)[:1000]
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        row.status = "error"
        row.last_error = str(e)[:1000]
        db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"GCP verify failed: {e}") from e

    row.status = "connected"
    row.last_error = None
    db.commit()
    return {"ok": True, **result}


@router.post("/gcp/projects/{project_row_id}/scan")
def scan_gcp_project(
    project_row_id: uuid.UUID,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    row = db.get(GcpProject, project_row_id)
    if not row or row.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "GCP project not found")
    if row.status != "connected":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Verify GCP connection before scanning")

    from app.worker.tasks import run_gcp_scan

    run_gcp_scan.delay(str(row.id))
    row.last_scan_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True, "queued": True, "project_id": str(row.id)}
