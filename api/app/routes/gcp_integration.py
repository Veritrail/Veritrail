"""GCP project integration routes — Workload Identity Federation and SA impersonation."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.route_deps import RequireAdmin
from app.core.security import current_principal
from app.models.gcp_project import GcpProject
from app.models.org import Org
from app.services.gcp_client import GcpClient
from app.services.gcp_impersonation import (
    AUTH_SERVICE_ACCOUNT_IMPERSONATION,
    impersonation_setup_manifest,
    platform_sa_config_error,
)
from app.services.gcp_wif import (
    AUTH_SERVICE_ACCOUNT_KEY,
    AUTH_WORKLOAD_IDENTITY,
    build_wif_audience,
    generate_wif_subject,
    jwks_document,
    oidc_discovery_document,
    setup_manifest,
)

router = APIRouter()
wif_router = APIRouter()


def _get_org(p, db: Session) -> Org:
    org = db.get(Org, uuid.UUID(p["org_id"]))
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    return org


class GcpWifConfigIn(BaseModel):
    project_number: str
    pool_id: str
    provider_id: str
    service_account_email: str
    wif_audience: str | None = None


class GcpImpersonationConfigIn(BaseModel):
    service_account_email: str


class GcpProjectOut(BaseModel):
    id: str
    project_id: str
    label: str
    status: str
    auth_method: str
    project_number: str | None = None
    pool_id: str | None = None
    provider_id: str | None = None
    service_account_email: str | None = None
    wif_subject: str | None = None
    last_scan_at: str | None = None
    last_error: str | None = None
    has_service_account: bool = False
    wif_configured: bool = False
    impersonation_configured: bool = False

    class Config:
        from_attributes = True


class GcpProjectIn(BaseModel):
    project_id: str
    label: str = ""
    auth_method: str = AUTH_WORKLOAD_IDENTITY
    project_number: str | None = None
    pool_id: str | None = None
    provider_id: str | None = None
    service_account_email: str | None = None
    wif_audience: str | None = None
    service_account_json: str | None = Field(default=None, deprecated=True)


class GcpProjectPatch(BaseModel):
    label: str | None = None
    project_number: str | None = None
    pool_id: str | None = None
    provider_id: str | None = None
    service_account_email: str | None = None
    wif_audience: str | None = None
    service_account_json: str | None = Field(default=None, deprecated=True)
    status: str | None = None


class GcpSetupOut(BaseModel):
    auth_method: str
    issuer_uri: str
    token_audience: str
    jwks_uri: str
    wif_subject: str
    project_id: str
    project_number: str | None = None
    pool_id: str
    provider_id: str
    service_account_email: str
    wif_audience: str
    principal_member: str
    terraform_path: str
    gcloud_script_path: str


class GcpImpersonationSetupOut(BaseModel):
    auth_method: str
    project_id: str
    platform_sa_email: str
    scanner_sa_email: str
    terraform_path: str
    gcloud_script_path: str
    platform_sa_configured: bool


def _wif_configured(row: GcpProject) -> bool:
    return bool(
        row.project_number
        and row.pool_id
        and row.provider_id
        and row.service_account_email
        and row.wif_subject
    )


def _impersonation_configured(row: GcpProject) -> bool:
    return bool((row.service_account_email or "").strip())


def _to_out(row: GcpProject) -> GcpProjectOut:
    return GcpProjectOut(
        id=str(row.id),
        project_id=row.project_id,
        label=row.label or row.project_id,
        status=row.status,
        auth_method=row.auth_method or AUTH_WORKLOAD_IDENTITY,
        project_number=row.project_number,
        pool_id=row.pool_id,
        provider_id=row.provider_id,
        service_account_email=row.service_account_email,
        wif_subject=row.wif_subject,
        last_scan_at=row.last_scan_at.isoformat() if row.last_scan_at else None,
        last_error=row.last_error,
        has_service_account=bool(row.service_account_json),
        wif_configured=_wif_configured(row),
        impersonation_configured=_impersonation_configured(row),
    )


def _apply_wif_fields(row: GcpProject, body: GcpWifConfigIn) -> None:
    pnum = body.project_number.strip()
    pool = body.pool_id.strip()
    provider = body.provider_id.strip()
    sa_email = body.service_account_email.strip()
    if not all([pnum, pool, provider, sa_email]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "WIF project_number, pool_id, provider_id, and service_account_email are required")
    row.project_number = pnum
    row.pool_id = pool
    row.provider_id = provider
    row.service_account_email = sa_email
    row.wif_audience = (body.wif_audience or "").strip() or build_wif_audience(pnum, pool, provider)


def _apply_impersonation_fields(row: GcpProject, body: GcpImpersonationConfigIn) -> None:
    sa_email = body.service_account_email.strip()
    if not sa_email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "service_account_email is required for impersonation auth")
    row.service_account_email = sa_email


@wif_router.get("/.well-known/openid-configuration")
def gcp_wif_oidc_discovery():
    return oidc_discovery_document()


@wif_router.get("/jwks")
def gcp_wif_jwks():
    return jwks_document()


@router.get("/gcp/wif/setup", response_model=GcpSetupOut)
def get_gcp_wif_setup(
    project_id: str,
    wif_subject: str,
    project_number: str | None = None,
    _p=Depends(current_principal),
):
    pid = project_id.strip()
    subject = wif_subject.strip()
    if not pid or not subject:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "project_id and wif_subject are required")
    return GcpSetupOut(**setup_manifest(project_id=pid, wif_subject=subject, project_number=project_number))


@router.get("/gcp/impersonation/setup", response_model=GcpImpersonationSetupOut)
def get_gcp_impersonation_setup(
    project_id: str,
    _p=Depends(current_principal),
):
    pid = project_id.strip()
    if not pid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "project_id is required")
    return GcpImpersonationSetupOut(**impersonation_setup_manifest(project_id=pid))


@router.get("/gcp/projects", response_model=list[GcpProjectOut])
def list_gcp_projects(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    rows = db.scalars(select(GcpProject).where(GcpProject.org_id == org.id).order_by(GcpProject.project_id)).all()
    return [_to_out(r) for r in rows]


@router.post("/gcp/projects", response_model=GcpProjectOut, status_code=201)
def create_gcp_project(body: GcpProjectIn, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    settings = get_settings()
    org = _get_org(p, db)
    pid = body.project_id.strip()
    if not pid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "project_id is required")

    auth_method = (body.auth_method or AUTH_WORKLOAD_IDENTITY).strip()
    if auth_method not in {AUTH_WORKLOAD_IDENTITY, AUTH_SERVICE_ACCOUNT_KEY, AUTH_SERVICE_ACCOUNT_IMPERSONATION}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unsupported auth_method: {auth_method}")

    sa_json = (body.service_account_json or "").strip() or None
    if auth_method == AUTH_SERVICE_ACCOUNT_KEY:
        if not settings.ALLOW_GCP_SA_JSON:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "service_account_key auth is disabled; use workload_identity or service_account_impersonation",
            )
        if not sa_json:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "service_account_json is required for service_account_key auth")
    elif sa_json and not settings.ALLOW_GCP_SA_JSON:
        sa_json = None

    existing = db.scalar(
        select(GcpProject).where(GcpProject.org_id == org.id, GcpProject.project_id == pid)
    )
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "GCP project already connected")

    wif_subject = generate_wif_subject() if auth_method == AUTH_WORKLOAD_IDENTITY else None
    row = GcpProject(
        org_id=org.id,
        project_id=pid,
        label=(body.label or pid).strip(),
        auth_method=auth_method,
        wif_subject=wif_subject,
        service_account_json=sa_json,
        status="pending",
    )
    if auth_method == AUTH_WORKLOAD_IDENTITY and body.project_number and body.pool_id and body.provider_id and body.service_account_email:
        _apply_wif_fields(row, GcpWifConfigIn(
            project_number=body.project_number,
            pool_id=body.pool_id,
            provider_id=body.provider_id,
            service_account_email=body.service_account_email,
            wif_audience=body.wif_audience,
        ))
    elif auth_method == AUTH_SERVICE_ACCOUNT_IMPERSONATION and body.service_account_email:
        _apply_impersonation_fields(row, GcpImpersonationConfigIn(service_account_email=body.service_account_email))
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
    settings = get_settings()
    org = _get_org(p, db)
    row = db.get(GcpProject, project_row_id)
    if not row or row.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "GCP project not found")
    if body.label is not None:
        row.label = body.label.strip()
    if body.project_number and body.pool_id and body.provider_id and body.service_account_email:
        _apply_wif_fields(row, GcpWifConfigIn(
            project_number=body.project_number,
            pool_id=body.pool_id,
            provider_id=body.provider_id,
            service_account_email=body.service_account_email,
            wif_audience=body.wif_audience,
        ))
    elif body.service_account_email and row.auth_method == AUTH_SERVICE_ACCOUNT_IMPERSONATION:
        _apply_impersonation_fields(row, GcpImpersonationConfigIn(service_account_email=body.service_account_email))
    if body.service_account_json is not None and body.service_account_json.strip():
        if not settings.ALLOW_GCP_SA_JSON:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "service_account_json upload is disabled")
        row.service_account_json = body.service_account_json.strip()
        row.auth_method = AUTH_SERVICE_ACCOUNT_KEY
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
    if row.auth_method == AUTH_WORKLOAD_IDENTITY and not _wif_configured(row):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Configure WIF pool, provider, and service account before verify")
    if row.auth_method == AUTH_SERVICE_ACCOUNT_IMPERSONATION and not _impersonation_configured(row):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Configure scanner service account email before verify")
    platform_err = platform_sa_config_error()
    if row.auth_method == AUTH_SERVICE_ACCOUNT_IMPERSONATION and platform_err:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, platform_err)
    try:
        result = GcpClient.from_project(row).verify(row.project_id)
        if row.auth_method in {AUTH_WORKLOAD_IDENTITY, AUTH_SERVICE_ACCOUNT_IMPERSONATION}:
            GcpClient.from_project(row).list_logging_sinks(row.project_id)
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
    if result.get("project_number") and not row.project_number:
        row.project_number = str(result["project_number"])
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
