"""Unified cloud account and coverage helpers for multi-cloud integrations."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AwsAccount, Finding
from app.models.azure_subscription import AzureSubscription
from app.models.gcp_project import GcpProject

CloudProvider = Literal["aws", "gcp", "azure"]


def _max_scan_at(values: list[datetime | None]) -> datetime | None:
    present = [v for v in values if v is not None]
    return max(present) if present else None


def open_findings_count(db: Session, *, org_id: uuid.UUID, provider: CloudProvider) -> int:
    base = select(func.count()).select_from(Finding).where(
        Finding.org_id == org_id,
        Finding.status == "open",
    )
    if provider == "aws":
        q = base.where(
            Finding.check_id.notlike("gcp.%"),
            Finding.check_id.notlike("azure.%"),
            Finding.check_id.notlike("github.%"),
            Finding.check_id.notlike("gitlab.%"),
        )
    elif provider == "gcp":
        q = base.where(Finding.check_id.like("gcp.%"))
    else:
        q = base.where(Finding.check_id.like("azure.%"))
    return int(db.scalar(q) or 0)


def list_cloud_accounts(db: Session, org_id: uuid.UUID) -> list[dict]:
    """Return normalized cloud account rows for AWS, GCP, and Azure."""
    rows: list[dict] = []

    aws_rows = db.scalars(
        select(AwsAccount).where(AwsAccount.org_id == org_id).order_by(AwsAccount.label, AwsAccount.account_id)
    ).all()
    for acc in aws_rows:
        rows.append(
            {
                "provider": "aws",
                "id": str(acc.id),
                "external_id": acc.account_id,
                "label": (acc.label or acc.account_id or "AWS account").strip(),
                "status": acc.status,
                "last_scan_at": acc.last_scan_at,
            }
        )

    gcp_rows = db.scalars(
        select(GcpProject).where(GcpProject.org_id == org_id).order_by(GcpProject.label, GcpProject.project_id)
    ).all()
    for proj in gcp_rows:
        rows.append(
            {
                "provider": "gcp",
                "id": str(proj.id),
                "external_id": proj.project_id,
                "label": (proj.label or proj.project_id).strip(),
                "status": proj.status,
                "last_scan_at": proj.last_scan_at,
            }
        )

    azure_rows = db.scalars(
        select(AzureSubscription)
        .where(AzureSubscription.org_id == org_id)
        .order_by(AzureSubscription.label, AzureSubscription.subscription_id)
    ).all()
    for sub in azure_rows:
        rows.append(
            {
                "provider": "azure",
                "id": str(sub.id),
                "external_id": sub.subscription_id,
                "label": (sub.label or sub.subscription_id).strip(),
                "status": sub.status,
                "last_scan_at": sub.last_scan_at,
            }
        )

    return rows


def build_cloud_coverage(db: Session, org_id: uuid.UUID) -> dict:
    """Per-provider connected count, open findings, and latest scan timestamp."""
    aws_connected = db.scalars(
        select(AwsAccount).where(AwsAccount.org_id == org_id, AwsAccount.status == "connected")
    ).all()
    gcp_connected = db.scalars(
        select(GcpProject).where(GcpProject.org_id == org_id, GcpProject.status == "connected")
    ).all()
    azure_connected = db.scalars(
        select(AzureSubscription).where(
            AzureSubscription.org_id == org_id,
            AzureSubscription.status == "connected",
        )
    ).all()

    providers = [
        {
            "provider": "aws",
            "connected_count": len(aws_connected),
            "open_findings_count": open_findings_count(db, org_id=org_id, provider="aws"),
            "last_scan_at": _max_scan_at([a.last_scan_at for a in aws_connected]),
        },
        {
            "provider": "gcp",
            "connected_count": len(gcp_connected),
            "open_findings_count": open_findings_count(db, org_id=org_id, provider="gcp"),
            "last_scan_at": _max_scan_at([p.last_scan_at for p in gcp_connected]),
        },
        {
            "provider": "azure",
            "connected_count": len(azure_connected),
            "open_findings_count": open_findings_count(db, org_id=org_id, provider="azure"),
            "last_scan_at": _max_scan_at([s.last_scan_at for s in azure_connected]),
        },
    ]
    return {
        "providers": providers,
        "total_connected": sum(p["connected_count"] for p in providers),
        "total_open_findings": sum(p["open_findings_count"] for p in providers),
    }
