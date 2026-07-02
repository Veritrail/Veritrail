"""Azure subscription integration routes."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.org_context import resolve_org
from app.core.route_deps import RequireAdmin
from app.core.security import current_principal
from app.models.azure_subscription import AzureSubscription
from app.models.org import Org
from app.services.azure_client import AzureClient

router = APIRouter()


def _get_org(p, db: Session) -> Org:
    return resolve_org(db, p)


class AzureSubscriptionOut(BaseModel):
    id: str
    subscription_id: str
    tenant_id: str
    client_id: str
    label: str
    status: str
    last_scan_at: str | None = None
    last_error: str | None = None
    has_client_secret: bool = True


class AzureSubscriptionIn(BaseModel):
    subscription_id: str
    tenant_id: str
    client_id: str
    client_secret: str | None = None
    label: str = ""


class AzureSubscriptionPatch(BaseModel):
    label: str | None = None
    tenant_id: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    status: str | None = None


def _to_out(row: AzureSubscription) -> AzureSubscriptionOut:
    return AzureSubscriptionOut(
        id=str(row.id),
        subscription_id=row.subscription_id,
        tenant_id=row.tenant_id,
        client_id=row.client_id,
        label=row.label or row.subscription_id,
        status=row.status,
        last_scan_at=row.last_scan_at.isoformat() if row.last_scan_at else None,
        last_error=row.last_error,
        has_client_secret=bool(row.client_secret),
    )


@router.get("/azure/subscriptions", response_model=list[AzureSubscriptionOut])
def list_azure_subscriptions(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    rows = db.scalars(
        select(AzureSubscription).where(AzureSubscription.org_id == org.id).order_by(AzureSubscription.subscription_id)
    ).all()
    return [_to_out(r) for r in rows]


@router.post("/azure/subscriptions", response_model=AzureSubscriptionOut, status_code=201)
def create_azure_subscription(
    body: AzureSubscriptionIn,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    sid = body.subscription_id.strip()
    if not all([sid, body.tenant_id.strip(), body.client_id.strip()]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "subscription_id, tenant_id, and client_id are required")
    secret = (body.client_secret or "").strip()
    if not secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "client_secret is required")

    existing = db.scalar(
        select(AzureSubscription).where(
            AzureSubscription.org_id == org.id,
            AzureSubscription.subscription_id == sid,
        )
    )
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Azure subscription already connected")

    row = AzureSubscription(
        org_id=org.id,
        subscription_id=sid,
        tenant_id=body.tenant_id.strip(),
        client_id=body.client_id.strip(),
        client_secret=secret,
        label=(body.label or sid).strip(),
        status="pending",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.patch("/azure/subscriptions/{subscription_row_id}", response_model=AzureSubscriptionOut)
def patch_azure_subscription(
    subscription_row_id: uuid.UUID,
    body: AzureSubscriptionPatch,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    row = db.get(AzureSubscription, subscription_row_id)
    if not row or row.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Azure subscription not found")
    if body.label is not None:
        row.label = body.label.strip()
    if body.tenant_id is not None:
        row.tenant_id = body.tenant_id.strip()
    if body.client_id is not None:
        row.client_id = body.client_id.strip()
    if body.client_secret is not None and body.client_secret.strip():
        row.client_secret = body.client_secret.strip()
    if body.status is not None:
        row.status = body.status.strip()
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.delete("/azure/subscriptions/{subscription_row_id}", status_code=204)
def delete_azure_subscription(
    subscription_row_id: uuid.UUID,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    row = db.get(AzureSubscription, subscription_row_id)
    if not row or row.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Azure subscription not found")
    db.delete(row)
    db.commit()


@router.post("/azure/subscriptions/{subscription_row_id}/verify")
def verify_azure_subscription(
    subscription_row_id: uuid.UUID,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    row = db.get(AzureSubscription, subscription_row_id)
    if not row or row.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Azure subscription not found")
    try:
        client = AzureClient(
            tenant_id=row.tenant_id,
            client_id=row.client_id,
            client_secret=row.client_secret,
        )
        result = client.verify(row.subscription_id)
        from app.services.azure_permission_probes import probe_azure_scan_permissions

        degraded_checks = probe_azure_scan_permissions(row)
    except ValueError as e:
        row.status = "error"
        row.last_error = str(e)[:1000]
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        row.status = "error"
        row.last_error = str(e)[:1000]
        db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Azure verify failed: {e}") from e

    row.status = "connected"
    row.last_error = None
    db.commit()
    return {"ok": True, **result, "degraded_checks": degraded_checks}


@router.post("/azure/subscriptions/{subscription_row_id}/scan")
def scan_azure_subscription(
    subscription_row_id: uuid.UUID,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    row = db.get(AzureSubscription, subscription_row_id)
    if not row or row.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Azure subscription not found")
    if row.status == "pending":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Verify Azure connection before scanning")

    from app.services.cloud_scan_runs import latest_running_cloud_scan
    from app.worker.tasks import run_azure_scan

    existing = latest_running_cloud_scan(db, provider="azure", resource_id=row.id)
    if existing:
        return {"ok": True, "queued": True, "deduped": True, "scan_run_id": str(existing.id)}

    run_azure_scan.delay(str(row.id))
    db.commit()
    return {"ok": True, "queued": True, "subscription_id": str(row.id)}
