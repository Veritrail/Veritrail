"""Public Trust Center — unauthenticated compliance transparency portal."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import Finding, AwsAccount
from app.models.auditor import TrustCenterConfig
from app.models.control import Control, CheckControl
from app.models.org import Org
from app.services.finding_history import finding_open_for_control
from app.services.check_frameworks import framework_catalog

router = APIRouter()


class TrustFrameworkScore(BaseModel):
    framework: str
    framework_label: str
    control_count: int
    passed: int
    failed: int
    no_data: int
    score_pct: float


class TrustCenterData(BaseModel):
    company_name: str
    company_logo_url: str | None
    custom_message: str | None
    is_enabled: bool
    frameworks: list[TrustFrameworkScore]
    last_scan_at: str | None
    connected_accounts: int
    recent_activity: dict


def _framework_label(framework_key: str) -> str:
    labels = {
        "soc2": "SOC 2",
        "cis_aws_l1": "CIS AWS Foundations L1",
        "iso27001": "ISO 27001",
    }
    return labels.get(framework_key, framework_key.upper())


@router.get("/{subdomain_slug}", response_model=TrustCenterData)
def get_trust_center(subdomain_slug: str, db: Session = Depends(get_db)):
    """Public trust center page data for a given org subdomain."""
    config = db.scalar(
        select(TrustCenterConfig).where(
            TrustCenterConfig.subdomain_slug == subdomain_slug,
            TrustCenterConfig.is_enabled == True,
        )
    )
    if not config:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trust center not found or disabled")

    org = db.get(Org, config.org_id)
    org_name = org.name if org else config.company_name

    # Connected accounts
    accounts = db.scalars(
        select(AwsAccount).where(
            AwsAccount.org_id == config.org_id,
            AwsAccount.status == "connected",
        )
    ).all()

    last_scan = max((a.last_scan_at for a in accounts if a.last_scan_at), default=None)

    # Compute framework scores
    frameworks_to_show = config.frameworks_to_show if config.frameworks_to_show else ["soc2", "cis_aws_l1"]
    catalog = framework_catalog()

    framework_scores = []
    for fw_key in frameworks_to_show:
        controls = db.scalars(
            select(Control).where(Control.framework == fw_key).order_by(Control.control_id)
        ).all()

        if not controls:
            continue

        acc_id = accounts[0].id if accounts else None
        open_findings: list[Finding] = []
        if acc_id:
            open_findings = db.scalars(
                select(Finding).where(
                    Finding.account_id == acc_id,
                    Finding.status == "open",
                )
            ).all()

        open_by_check: dict[str, list[Finding]] = {}
        for f in open_findings:
            open_by_check.setdefault(f.check_id, []).append(f)

        passed = 0
        failed = 0
        no_data = 0
        for ctrl in controls:
            check_ids = [
                row[0] for row in db.execute(
                    select(CheckControl.check_id).where(CheckControl.control_id == ctrl.id)
                ).all()
            ]
            if not check_ids:
                no_data += 1
                continue
            hits: list[Finding] = []
            for cid in check_ids:
                hits.extend(open_by_check.get(cid, []))
            if any(finding_open_for_control(f, f.status) for f in hits):
                failed += 1
            elif acc_id:
                passed += 1
            else:
                no_data += 1

        total = passed + failed + no_data
        score = round((passed / max(total, 1)) * 100, 1)

        framework_scores.append(TrustFrameworkScore(
            framework=fw_key,
            framework_label=_framework_label(fw_key),
            control_count=len(controls),
            passed=passed,
            failed=failed,
            no_data=no_data,
            score_pct=score,
        ))

    # Recent activity summary
    recent_activity: dict = {}
    if last_scan:
        recent_activity["last_scan_at"] = last_scan.isoformat()
    recent_activity["connected_accounts"] = len(accounts)

    return TrustCenterData(
        company_name=config.company_name or org_name,
        company_logo_url=config.company_logo_url,
        custom_message=config.custom_message,
        is_enabled=config.is_enabled,
        frameworks=framework_scores,
        last_scan_at=last_scan.isoformat() if last_scan else None,
        connected_accounts=len(accounts),
        recent_activity=recent_activity,
    )


@router.get("/{subdomain_slug}/frameworks", response_model=list[TrustFrameworkScore])
def get_trust_center_frameworks(subdomain_slug: str, db: Session = Depends(get_db)):
    """Detailed framework scores for a trust center."""
    config = db.scalar(
        select(TrustCenterConfig).where(
            TrustCenterConfig.subdomain_slug == subdomain_slug,
            TrustCenterConfig.is_enabled == True,
        )
    )
    if not config:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trust center not found or disabled")

    accounts = db.scalars(
        select(AwsAccount).where(
            AwsAccount.org_id == config.org_id,
            AwsAccount.status == "connected",
        )
    ).all()

    acc_id = accounts[0].id if accounts else None
    open_findings: list[Finding] = []
    if acc_id:
        open_findings = db.scalars(
            select(Finding).where(
                Finding.account_id == acc_id,
                Finding.status == "open",
            )
        ).all()

    open_by_check: dict[str, list[Finding]] = {}
    for f in open_findings:
        open_by_check.setdefault(f.check_id, []).append(f)

    frameworks_to_show = config.frameworks_to_show if config.frameworks_to_show else ["soc2", "cis_aws_l1"]

    result = []
    for fw_key in frameworks_to_show:
        controls = db.scalars(
            select(Control).where(Control.framework == fw_key).order_by(Control.control_id)
        ).all()
        if not controls:
            continue
        passed = 0
        failed = 0
        no_data = 0
        for ctrl in controls:
            check_ids = [
                row[0] for row in db.execute(
                    select(CheckControl.check_id).where(CheckControl.control_id == ctrl.id)
                ).all()
            ]
            if not check_ids:
                no_data += 1
                continue
            hits: list[Finding] = []
            for cid in check_ids:
                hits.extend(open_by_check.get(cid, []))
            if any(finding_open_for_control(f, f.status) for f in hits):
                failed += 1
            elif acc_id:
                passed += 1
            else:
                no_data += 1

        total = passed + failed + no_data
        score = round((passed / max(total, 1)) * 100, 1)
        result.append(TrustFrameworkScore(
            framework=fw_key,
            framework_label=_framework_label(fw_key),
            control_count=len(controls),
            passed=passed,
            failed=failed,
            no_data=no_data,
            score_pct=score,
        ))

    return result
