"""Unified cloud account and coverage helpers for multi-cloud integrations."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AwsAccount, Finding, Org
from app.models.azure_subscription import AzureSubscription
from app.models.gcp_project import GcpProject
from app.services.check_settings import hidden_check_ids
from app.services.finding_supersession import RETIRED_FINDING_CHECKS

CloudProvider = Literal["aws", "gcp", "azure"]


def _max_scan_at(values: list[datetime | None]) -> datetime | None:
    present = [v for v in values if v is not None]
    return max(present) if present else None


def hidden_finding_check_ids(db: Session, org_id: uuid.UUID) -> set[str]:
    """Match GET /v1/findings/summary hidden-check filtering."""
    org = db.get(Org, org_id)
    return hidden_check_ids(org.settings if org else {}) | RETIRED_FINDING_CHECKS


def _open_findings_base(db: Session, *, org_id: uuid.UUID, hidden: set[str]):
    q = select(func.count()).select_from(Finding).where(
        Finding.org_id == org_id,
        Finding.status == "open",
    )
    if hidden:
        q = q.where(Finding.check_id.notin_(hidden))
    return q


def account_open_findings_count(
    db: Session,
    *,
    org_id: uuid.UUID,
    provider: CloudProvider,
    resource_id: uuid.UUID,
) -> int:
    """Open findings for one AWS account, GCP project, or Azure subscription."""
    hidden = hidden_finding_check_ids(db, org_id)
    q = _open_findings_base(db, org_id=org_id, hidden=hidden)
    if provider == "aws":
        q = q.where(Finding.account_id == resource_id)
    elif provider == "gcp":
        q = q.where(Finding.gcp_project_id == resource_id)
    else:
        q = q.where(Finding.azure_subscription_id == resource_id)
    return int(db.scalar(q) or 0)


def open_findings_count(db: Session, *, org_id: uuid.UUID, provider: CloudProvider) -> int:
    """Open findings aggregated for a cloud provider within an org."""
    hidden = hidden_finding_check_ids(db, org_id)
    q = _open_findings_base(db, org_id=org_id, hidden=hidden)
    if provider == "aws":
        q = q.where(Finding.account_id.isnot(None))
    elif provider == "gcp":
        q = q.where(Finding.gcp_project_id.isnot(None))
    else:
        q = q.where(Finding.azure_subscription_id.isnot(None))
    return int(db.scalar(q) or 0)


def cloud_open_findings_total(db: Session, org_id: uuid.UUID) -> int:
    """Sum of open findings across AWS, GCP, and Azure scopes."""
    return sum(open_findings_count(db, org_id=org_id, provider=p) for p in ("aws", "gcp", "azure"))


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
                "open_findings_count": account_open_findings_count(
                    db, org_id=org_id, provider="aws", resource_id=acc.id
                ),
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
                "open_findings_count": account_open_findings_count(
                    db, org_id=org_id, provider="gcp", resource_id=proj.id
                ),
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
                "open_findings_count": account_open_findings_count(
                    db, org_id=org_id, provider="azure", resource_id=sub.id
                ),
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
