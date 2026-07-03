"""Org-level settings: notifications + automated scan schedule."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.org_context import resolve_org
from app.core.public_url import PublicUrlError, validate_trust_logo_reference
from app.core.security import current_principal
from app.models.org import Org, User
from app.models import AwsAccount, Finding
from app.models.auditor import TrustCenterConfig
from app.services.check_evidence import all_evidence_classes
from app.checks.optional_checks import OPTIONAL_LINKED
from app.services.check_settings import hidden_check_ids, optional_checks_for_ui
from app.services.cis_benchmark_coverage import cis_benchmark_coverage
from app.services.digest_tokens import ensure_digest_unsubscribe_token
from app.services.org_activity import log_org_activity
from app.core.route_deps import RequireAdmin
from app.services.scan_schedule import (
    DEFAULT_SCANNING,
    get_scanning_settings,
    max_interval_for_plan,
    min_custom_hours_for_plan,
    next_scan_at,
    validate_scanning,
)
from app.services.trust_logo_storage import TrustLogoError, delete_trust_logo, is_uploaded_trust_logo_path, save_trust_logo
from app.services.evidence_source_registry import EVIDENCE_SOURCE_CATEGORIES
from app.services.evidence_source_store import apply_evidence_source_updates, load_evidence_sources
from app.services.coverage_overrides import merge_coverage_overrides
from app.services.cross_account_coverage import merge_cross_account_coverage
from app.services.custom_evidence_categories import (
    get_custom_evidence_categories,
    merge_custom_evidence_categories,
)

router = APIRouter()

DEFAULT_SETTINGS: dict = {
    "checks": {},
    "scanning": dict(DEFAULT_SCANNING),
    "notifications": {
        "email_digest_enabled": False,
        "digest_email": None,
        "digest_unsubscribe_token": None,
        "slack_webhook_url": None,
        "slack_digest_enabled": False,
        "slack_scan_failure_enabled": True,
        "slack_critical_alerts_enabled": True,
        "scan_failure_email_enabled": True,
        "critical_alert_enabled": True,
        "evidence_renewal_email_enabled": True,
    },
    "features": {
        "ai_finding_review_enabled": True,
    },
    "security": {
        "sso_required": False,
    },
}


def _merged(stored: dict) -> dict:
    merged = {**DEFAULT_SETTINGS}
    merged["checks"] = {**stored.get("checks", {})}
    merged["scanning"] = get_scanning_settings(stored)
    merged["notifications"] = {**DEFAULT_SETTINGS["notifications"], **stored.get("notifications", {})}
    merged["features"] = {**DEFAULT_SETTINGS["features"], **stored.get("features", {})}
    merged["security"] = {**DEFAULT_SETTINGS["security"], **stored.get("security", {})}
    return merged


class CheckSettingIn(BaseModel):
    enabled: bool


class NotificationsIn(BaseModel):
    email_digest_enabled: bool = False
    digest_email: str | None = None
    slack_webhook_url: str | None = None
    slack_digest_enabled: bool = False
    slack_scan_failure_enabled: bool = True
    slack_critical_alerts_enabled: bool = True
    scan_failure_email_enabled: bool = True
    critical_alert_enabled: bool = True
    evidence_renewal_email_enabled: bool = True


class FeaturesIn(BaseModel):
    ai_finding_review_enabled: bool = True


class SecurityIn(BaseModel):
    sso_required: bool = False


class EvidenceSourceEntryIn(BaseModel):
    vendor: str | None = None
    owner: str | None = None
    cadence: str | None = None
    scope_description: str | None = None
    source_type: str | None = None


class EvidenceSourcesIn(BaseModel):
    entries: dict[str, EvidenceSourceEntryIn]


class CoverageOverrideEntryIn(BaseModel):
    status: Literal["out_of_scope", "not_applicable"] | None = None
    reason: str | None = None


class CoverageOverridesIn(BaseModel):
    # Accepts a bare status string (legacy), null to clear, or an object
    # carrying a justification for the audit trail.
    entries: dict[
        str,
        CoverageOverrideEntryIn | Literal["out_of_scope", "not_applicable"] | None,
    ]


class CrossAccountCoverageEntryIn(BaseModel):
    account_id: str | None = None
    reason: str | None = None
    expires_at: str | None = None


class CrossAccountCoverageIn(BaseModel):
    # Per composite: an object to attest coverage in another AWS account, or
    # null to clear.
    entries: dict[str, CrossAccountCoverageEntryIn | None]


class ComplianceThresholdsIn(BaseModel):
    # Severities that fail a control. Default (when unset) is critical + high;
    # medium becomes "at risk", low is noted.
    fail_severities: list[Literal["critical", "high", "medium", "low"]] | None = None


class CustomEvidenceCategoryIn(BaseModel):
    key: str
    label: str


class CustomEvidenceCategoriesIn(BaseModel):
    entries: list[CustomEvidenceCategoryIn]


class EvidenceSourceCategoryOut(BaseModel):
    key: str
    label: str
    composite_ids: list[str]
    entry: dict | None = None


class ScanningIn(BaseModel):
    enabled: bool = True
    interval: Literal["daily", "weekly", "custom", "manual"] = "daily"
    custom_hours: int | None = None

    @field_validator("interval")
    @classmethod
    def normalize_interval(cls, v: str) -> str:
        if v not in ("daily", "weekly", "custom", "manual"):
            raise ValueError("interval must be daily, weekly, custom, or manual")
        return v


class ScanStatusOut(BaseModel):
    account_connected: bool
    last_scan_at: str | None
    next_scan_at: str | None
    max_interval: Literal["daily", "weekly"]
    min_custom_hours: int


class SettingsPatch(BaseModel):
    checks: dict[str, CheckSettingIn] | None = None
    scanning: ScanningIn | None = None
    notifications: NotificationsIn | None = None
    features: FeaturesIn | None = None
    security: SecurityIn | None = None
    evidence_sources: EvidenceSourcesIn | None = None
    coverage_overrides: CoverageOverridesIn | None = None
    cross_account_coverage: CrossAccountCoverageIn | None = None
    compliance_thresholds: ComplianceThresholdsIn | None = None
    custom_evidence_categories: CustomEvidenceCategoriesIn | None = None


class OptionalCheckOut(BaseModel):
    check_id: str
    label: str
    summary: str
    description: str
    default_enabled: bool
    enabled: bool


class SettingsOut(BaseModel):
    checks: dict
    optional_checks: list[OptionalCheckOut]
    evidence_classes: dict[str, str] = {}
    cis_benchmark_coverage: dict | None = None
    scanning: dict
    notifications: dict
    features: dict
    security: dict
    evidence_source_categories: list[EvidenceSourceCategoryOut] = []
    custom_evidence_categories: list[dict[str, str]] = []
    scan_status: ScanStatusOut
    account_email: str | None = None


def _evidence_source_categories_out(
    sources: dict[str, dict],
    org_settings: dict | None = None,
) -> list[EvidenceSourceCategoryOut]:
    from app.services.custom_evidence_categories import custom_category_defs

    built = [
        EvidenceSourceCategoryOut(
            key=cat["key"],
            label=cat["label"],
            composite_ids=cat["composite_ids"],
            entry=sources.get(cat["key"]),
        )
        for cat in EVIDENCE_SOURCE_CATEGORIES
    ]
    for custom in custom_category_defs(org_settings):
        built.append(
            EvidenceSourceCategoryOut(
                key=custom["key"],
                label=custom["label"],
                composite_ids=custom.get("composite_ids") or [],
                entry=sources.get(custom["key"]),
            )
        )
    return built


def _get_org(p, db: Session) -> Org:
    return resolve_org(db, p)


def _scan_status(org: Org, db: Session) -> ScanStatusOut:
    acc = db.scalars(
        select(AwsAccount).where(
            AwsAccount.org_id == org.id,
            AwsAccount.status == "connected",
        )
    ).first()
    scanning = get_scanning_settings(org.settings or {})
    last = acc.last_scan_at if acc else None
    nxt = next_scan_at(last, scanning) if acc else None
    return ScanStatusOut(
        account_connected=acc is not None,
        last_scan_at=last.isoformat() if last else None,
        next_scan_at=nxt.isoformat() if nxt else None,
        max_interval=max_interval_for_plan(org.plan),
        min_custom_hours=min_custom_hours_for_plan(org.plan),
    )


@router.get("", response_model=SettingsOut)
def get_settings(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    user = db.get(User, uuid.UUID(p["sub"]))
    org_settings = org.settings or {}
    merged = _merged(org_settings)
    registry_sources = load_evidence_sources(db, org.id)
    return SettingsOut(
        **merged,
        optional_checks=optional_checks_for_ui(org_settings),
        evidence_classes=all_evidence_classes(),
        cis_benchmark_coverage=cis_benchmark_coverage(),
        evidence_source_categories=_evidence_source_categories_out(registry_sources, org_settings),
        custom_evidence_categories=get_custom_evidence_categories(org_settings),
        scan_status=_scan_status(org, db),
        account_email=user.email if user and user.email else None,
    )


@router.patch("", response_model=SettingsOut)
def patch_settings(body: SettingsPatch, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    current = dict(org.settings or {})

    if body.checks is not None:
        checks = dict(current.get("checks", {}))
        for check_id, cfg in body.checks.items():
            checks[check_id] = {"enabled": cfg.enabled}
            for linked in OPTIONAL_LINKED.get(check_id, []):
                checks[linked] = {"enabled": cfg.enabled}
        current["checks"] = checks

    if body.scanning is not None:
        payload = {
            "enabled": body.scanning.enabled,
            "interval": body.scanning.interval,
            "custom_hours": body.scanning.custom_hours,
        }
        try:
            validate_scanning(payload, org.plan)
        except ValueError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
        interval = body.scanning.interval
        enabled = body.scanning.enabled and interval != "manual"
        stored = {"enabled": enabled, "interval": interval}
        if interval == "custom":
            stored["custom_hours"] = body.scanning.custom_hours
        current["scanning"] = stored

    if body.notifications is not None:
        current["notifications"] = ensure_digest_unsubscribe_token(body.notifications.model_dump())

    if body.features is not None:
        features = dict(current.get("features", {}))
        features["ai_finding_review_enabled"] = body.features.ai_finding_review_enabled
        current["features"] = features

    if body.security is not None:
        security = dict(current.get("security", {}))
        security["sso_required"] = body.security.sso_required
        current["security"] = security

    if body.evidence_sources is not None:
        patches = {k: v.model_dump() for k, v in body.evidence_sources.entries.items()}
        apply_evidence_source_updates(db, org.id, patches, user_id=p.get("sub"))

    if body.coverage_overrides is not None or body.cross_account_coverage is not None:
        actor_user = db.get(User, uuid.UUID(p["sub"])) if p.get("sub") else None
        actor_label = actor_user.email if actor_user and actor_user.email else p.get("sub")

    if body.coverage_overrides is not None:
        patches = {
            k: (v.model_dump() if isinstance(v, CoverageOverrideEntryIn) else v)
            for k, v in body.coverage_overrides.entries.items()
        }
        current["coverage_overrides"] = merge_coverage_overrides(
            current,
            patches,
            actor=actor_label,
        )

    if body.cross_account_coverage is not None:
        patches = {
            k: (v.model_dump() if isinstance(v, CrossAccountCoverageEntryIn) else None)
            for k, v in body.cross_account_coverage.entries.items()
        }
        current["cross_account_coverage"] = merge_cross_account_coverage(
            current,
            patches,
            actor=actor_label,
        )

    if body.compliance_thresholds is not None:
        fail_sev = body.compliance_thresholds.fail_severities
        current["compliance_thresholds"] = {
            "fail_severities": fail_sev if fail_sev else ["critical", "high"],
        }

    if body.custom_evidence_categories is not None:
        current["custom_evidence_categories"] = merge_custom_evidence_categories(
            current,
            [e.model_dump() for e in body.custom_evidence_categories.entries],
        )

    changed_sections = [
        name
        for name, val in (
            ("checks", body.checks),
            ("scanning", body.scanning),
            ("notifications", body.notifications),
            ("features", body.features),
            ("evidence_sources", body.evidence_sources),
            ("coverage_overrides", body.coverage_overrides),
            ("cross_account_coverage", body.cross_account_coverage),
            ("compliance_thresholds", body.compliance_thresholds),
            ("custom_evidence_categories", body.custom_evidence_categories),
        )
        if val is not None
    ]
    org.settings = current
    db.add(org)
    log_org_activity(
        db,
        org_id=org.id,
        actor_user_id=uuid.UUID(p["sub"]) if p.get("sub") else None,
        action="org.settings_updated",
        target_type="org",
        target_id=str(org.id),
        detail={"sections": changed_sections},
    )
    db.commit()
    db.refresh(org)
    user = db.get(User, uuid.UUID(p["sub"]))
    merged = _merged(org.settings)
    registry_sources = load_evidence_sources(db, org.id)
    org_settings = org.settings or {}
    return SettingsOut(
        **merged,
        optional_checks=optional_checks_for_ui(org.settings),
        evidence_classes=all_evidence_classes(),
        cis_benchmark_coverage=cis_benchmark_coverage(),
        evidence_source_categories=_evidence_source_categories_out(registry_sources, org_settings),
        custom_evidence_categories=get_custom_evidence_categories(org_settings),
        scan_status=_scan_status(org, db),
        account_email=user.email if user and user.email else None,
    )


@router.post("/test-digest", status_code=200)
def test_digest(_rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    """Fire a digest email immediately to the configured address (or current user)."""
    from app.services.digest import send_digest
    from datetime import datetime, timedelta, timezone

    org = _get_org(p, db)
    org_settings = org.settings or {}
    digest_email = org_settings.get("notifications", {}).get("digest_email")

    if not digest_email:
        user = db.get(User, uuid.UUID(p["sub"]))
        if not user or not user.email:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "No recipient email configured")
        digest_email = user.email

    acc = db.scalars(
        select(AwsAccount).where(
            AwsAccount.org_id == org.id,
            AwsAccount.status == "connected",
        )
    ).first()

    if not acc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No connected AWS account")

    since = datetime.now(timezone.utc) - timedelta(days=7)

    hidden = hidden_check_ids(org_settings)
    open_q = select(Finding).where(
        Finding.account_id == acc.id,
        Finding.status == "open",
    )
    if hidden:
        open_q = open_q.where(Finding.check_id.notin_(hidden))
    open_findings = db.scalars(open_q.order_by(Finding.risk_score.desc())).all()

    new_q = select(Finding).where(
        Finding.account_id == acc.id,
        Finding.first_seen >= since,
    )
    if hidden:
        new_q = new_q.where(Finding.check_id.notin_(hidden))
    new_this_week = db.scalars(new_q).all()

    from sqlalchemy import func as sa_func
    resolved_count = db.scalar(
        select(sa_func.count()).select_from(
            select(Finding).where(
                Finding.account_id == acc.id,
                Finding.status == "resolved",
                Finding.last_seen >= since,
            ).subquery()
        )
    ) or 0

    from app.services.digest_tokens import persist_digest_unsubscribe_token
    from app.services.digest_data import gather_digest_extras

    unsubscribe_token = persist_digest_unsubscribe_token(db, org)
    per_day, coverage, prev = gather_digest_extras(db, org_id=org.id, account_id=acc.id, since=since)

    ok = send_digest(
        to=digest_email,
        org_name=org.name if hasattr(org, "name") else str(org.id),
        account_label=acc.label,
        open_findings=[
            {"title": f.title, "severity": f.severity, "risk_score": f.risk_score, "resource_arn": f.resource_arn, "check_id": f.check_id}
            for f in open_findings
        ],
        new_this_week=[{"title": f.title, "severity": f.severity} for f in new_this_week],
        resolved_this_week=resolved_count,
        unsubscribe_token=unsubscribe_token,
        per_day=per_day,
        coverage=coverage,
        prev=prev,
    )

    if not ok:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Failed to send email — check SMTP settings in .env")

    return {"sent_to": digest_email}


class SlackTestBody(BaseModel):
    url: str | None = None


_ALLOWED_SLACK_HOSTS = frozenset({"hooks.slack.com", "hooks.slack-gov.com"})


def _validate_slack_webhook(url: str) -> str:
    from urllib.parse import urlparse

    parsed = urlparse(url.strip())
    if parsed.scheme != "https" or parsed.hostname not in _ALLOWED_SLACK_HOSTS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Webhook must be https://hooks.slack.com/... or https://hooks.slack-gov.com/...",
        )
    return url.strip()


@router.post("/test-slack", status_code=200)
def test_slack(_rbac: RequireAdmin, body: SlackTestBody = SlackTestBody(), p=Depends(current_principal), db: Session = Depends(get_db)):
    """POST a test message to the configured Slack webhook URL."""
    import httpx

    org = _get_org(p, db)
    webhook_url = body.url or (org.settings or {}).get("notifications", {}).get("slack_webhook_url")
    if not webhook_url:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No Slack webhook URL configured")
    webhook_url = _validate_slack_webhook(webhook_url)

    try:
        resp = httpx.post(
            webhook_url,
            json={"text": ":white_check_mark: *Veritrail* — Slack notifications are working."},
            timeout=10,
        )
        if resp.status_code != 200:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Slack returned {resp.status_code}: {resp.text}")
    except httpx.RequestError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Slack request failed: {e}")

    return {"ok": True}


# ── Trust Center Settings ──────────────────────────────────────────

class TrustCenterSettingsIn(BaseModel):
    is_enabled: bool = False
    subdomain_slug: str
    company_name: str
    company_logo_url: str | None = None
    frameworks_to_show: list[str] = ["soc2", "cis_aws_l1"]
    custom_message: str | None = None

    @field_validator("company_logo_url")
    @classmethod
    def validate_company_logo_url(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        try:
            return validate_trust_logo_reference(value, field="Logo URL")
        except PublicUrlError as exc:
            raise ValueError(str(exc)) from exc


class TrustCenterSettingsOut(BaseModel):
    model_config = {"from_attributes": True}

    is_enabled: bool
    subdomain_slug: str | None
    company_name: str | None
    company_logo_url: str | None
    frameworks_to_show: list[str]
    custom_message: str | None
    configured: bool
    last_updated_at: datetime | None = None


@router.get("/trust-center", response_model=TrustCenterSettingsOut)
def get_trust_center_settings(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    config = db.scalar(
        select(TrustCenterConfig).where(TrustCenterConfig.org_id == org.id)
    )
    if not config:
        return TrustCenterSettingsOut(
            is_enabled=False,
            subdomain_slug=None,
            company_name=None,
            company_logo_url=None,
            frameworks_to_show=["soc2", "cis_aws_l1"],
            custom_message=None,
            configured=False,
            last_updated_at=None,
        )
    return TrustCenterSettingsOut(
        is_enabled=config.is_enabled,
        subdomain_slug=config.subdomain_slug,
        company_name=config.company_name,
        company_logo_url=config.company_logo_url,
        frameworks_to_show=config.frameworks_to_show if config.frameworks_to_show else ["soc2", "cis_aws_l1"],
        custom_message=config.custom_message,
        configured=True,
        last_updated_at=config.last_updated_at,
    )


@router.put("/trust-center", response_model=TrustCenterSettingsOut)
def update_trust_center_settings(body: TrustCenterSettingsIn, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)

    config = db.scalar(
        select(TrustCenterConfig).where(TrustCenterConfig.org_id == org.id)
    )

    if not config:
        config = TrustCenterConfig(org_id=org.id)
        db.add(config)

    old_logo = config.company_logo_url
    new_logo = body.company_logo_url
    if old_logo and is_uploaded_trust_logo_path(old_logo) and old_logo != new_logo:
        delete_trust_logo(org.id)

    config.is_enabled = body.is_enabled
    config.subdomain_slug = body.subdomain_slug
    config.company_name = body.company_name
    config.company_logo_url = body.company_logo_url
    config.frameworks_to_show = body.frameworks_to_show
    config.custom_message = body.custom_message
    db.commit()
    db.refresh(config)

    return TrustCenterSettingsOut(
        is_enabled=config.is_enabled,
        subdomain_slug=config.subdomain_slug,
        company_name=config.company_name,
        company_logo_url=config.company_logo_url,
        frameworks_to_show=config.frameworks_to_show if config.frameworks_to_show else ["soc2", "cis_aws_l1"],
        custom_message=config.custom_message,
        configured=True,
        last_updated_at=config.last_updated_at,
    )


@router.post("/trust-center/logo", response_model=TrustCenterSettingsOut)
def upload_trust_center_logo(
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
    file: UploadFile = File(...),
):
    org = _get_org(p, db)
    content = file.file.read()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Logo file is empty")

    try:
        logo_path = save_trust_logo(org.id, content)
    except TrustLogoError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    config = db.scalar(
        select(TrustCenterConfig).where(TrustCenterConfig.org_id == org.id)
    )
    if not config:
        config = TrustCenterConfig(org_id=org.id)
        db.add(config)

    config.company_logo_url = logo_path
    db.commit()
    db.refresh(config)

    return TrustCenterSettingsOut(
        is_enabled=config.is_enabled,
        subdomain_slug=config.subdomain_slug,
        company_name=config.company_name,
        company_logo_url=config.company_logo_url,
        frameworks_to_show=config.frameworks_to_show if config.frameworks_to_show else ["soc2", "cis_aws_l1"],
        custom_message=config.custom_message,
        configured=True,
        last_updated_at=config.last_updated_at,
    )


@router.delete("/trust-center/logo", response_model=TrustCenterSettingsOut)
def remove_trust_center_logo(_rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    config = db.scalar(
        select(TrustCenterConfig).where(TrustCenterConfig.org_id == org.id)
    )
    if not config:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trust center not configured")

    if is_uploaded_trust_logo_path(config.company_logo_url):
        delete_trust_logo(org.id)

    config.company_logo_url = None
    db.commit()
    db.refresh(config)

    return TrustCenterSettingsOut(
        is_enabled=config.is_enabled,
        subdomain_slug=config.subdomain_slug,
        company_name=config.company_name,
        company_logo_url=config.company_logo_url,
        frameworks_to_show=config.frameworks_to_show if config.frameworks_to_show else ["soc2", "cis_aws_l1"],
        custom_message=config.custom_message,
        configured=True,
        last_updated_at=config.last_updated_at,
    )
