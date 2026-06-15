"""Public Trust Center — unauthenticated security profile (no live posture scores)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import AwsAccount
from app.models.auditor import TrustCenterConfig
from app.models.org import Org

router = APIRouter()

MONITORING_AREAS = [
    "Identity & access",
    "Data protection",
    "Logging & monitoring",
    "Change management",
    "Backup & resilience",
    "Network exposure",
]

FRAMEWORK_DOCUMENTS: dict[str, tuple[str, str]] = {
    "soc2": ("SOC 2 Type II report", "on_request"),
    "cis_aws_l1": ("CIS benchmark overview", "on_request"),
    "iso27001": ("ISO 27001 certificate", "on_request"),
}

DEFAULT_DOCUMENTS: list[tuple[str, str, str]] = [
    ("security_overview", "Security overview", "on_request"),
    ("dpa", "Data processing agreement", "on_request"),
    ("subprocessors", "Subprocessor list", "on_request"),
]


def _framework_label(framework_key: str) -> str:
    labels = {
        "soc2": "SOC 2",
        "cis_aws_l1": "CIS AWS Foundations L1",
        "iso27001": "ISO 27001",
    }
    return labels.get(framework_key, framework_key.upper())


def _scan_freshness(last_scan: datetime | None) -> str:
    if not last_scan:
        return "awaiting_first_scan"
    if last_scan.tzinfo is None:
        last_scan = last_scan.replace(tzinfo=timezone.utc)
    age = datetime.now(timezone.utc) - last_scan
    if age < timedelta(hours=24):
        return "within_24h"
    if age < timedelta(days=7):
        return "within_7_days"
    return "stale"


def _freshness_label(code: str) -> str:
    return {
        "within_24h": "Updated within the last day",
        "within_7_days": "Updated within the last week",
        "stale": "Monitoring active — refresh pending",
        "awaiting_first_scan": "Awaiting first scan",
    }[code]


class TrustFrameworkRef(BaseModel):
    framework: str
    framework_label: str


class TrustDocumentRef(BaseModel):
    id: str
    label: str
    availability: str


class TrustCenterData(BaseModel):
    company_name: str
    company_logo_url: str | None
    custom_message: str | None
    monitoring_active: bool
    refresh_cadence: str
    scan_freshness: str
    scan_freshness_label: str
    auditor_access_model: str
    frameworks: list[TrustFrameworkRef]
    monitoring_areas: list[str]
    documents: list[TrustDocumentRef]


def _build_documents(framework_keys: list[str]) -> list[TrustDocumentRef]:
    docs: list[TrustDocumentRef] = []
    seen: set[str] = set()
    for key in framework_keys:
        entry = FRAMEWORK_DOCUMENTS.get(key)
        if not entry:
            continue
        doc_id = f"framework_{key}"
        if doc_id in seen:
            continue
        seen.add(doc_id)
        label, availability = entry
        docs.append(TrustDocumentRef(id=doc_id, label=label, availability=availability))
    for doc_id, label, availability in DEFAULT_DOCUMENTS:
        if doc_id in seen:
            continue
        seen.add(doc_id)
        docs.append(TrustDocumentRef(id=doc_id, label=label, availability=availability))
    return docs


@router.get("/{subdomain_slug}", response_model=TrustCenterData)
def get_trust_center(subdomain_slug: str, db: Session = Depends(get_db)):
    """Public security profile for a given org slug. No scores, gaps, or finding counts."""
    config = db.scalar(
        select(TrustCenterConfig).where(
            TrustCenterConfig.subdomain_slug == subdomain_slug,
            TrustCenterConfig.is_enabled == True,  # noqa: E712
        )
    )
    if not config:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trust center not found or disabled")

    org = db.get(Org, config.org_id)
    org_name = org.name if org else config.company_name

    accounts = db.scalars(
        select(AwsAccount).where(
            AwsAccount.org_id == config.org_id,
            AwsAccount.status == "connected",
        )
    ).all()

    last_scan = max((a.last_scan_at for a in accounts if a.last_scan_at), default=None)
    freshness = _scan_freshness(last_scan)
    monitoring_active = bool(accounts) and freshness != "awaiting_first_scan"

    framework_keys = config.frameworks_to_show if config.frameworks_to_show else ["soc2", "cis_aws_l1"]
    frameworks = [
        TrustFrameworkRef(framework=key, framework_label=_framework_label(key))
        for key in framework_keys
    ]

    return TrustCenterData(
        company_name=config.company_name or org_name,
        company_logo_url=config.company_logo_url,
        custom_message=config.custom_message,
        monitoring_active=monitoring_active,
        refresh_cadence="daily",
        scan_freshness=freshness,
        scan_freshness_label=_freshness_label(freshness),
        auditor_access_model="private_invite",
        frameworks=frameworks,
        monitoring_areas=list(MONITORING_AREAS),
        documents=_build_documents(framework_keys),
    )
