"""Auditor-facing composite control roll-ups from mapped check IDs."""
from __future__ import annotations

import json
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AwsAccount, Finding, Org, ScanRun
from app.models.github import IdentityProvider
from app.checks.registry import (
    integration_sync_checks_for,
    is_integration_sync_check,
    is_source_control_check,
    source_control_checks_for,
)
from app.services.check_coverage import control_coverage_tier, extended_checks_in_list, tier_display_label, tier_for_check
from app.services.check_evidence import evidence_class_for_check
from app.services.check_settings import hidden_check_ids
from app.services.control_status import (
    DEFAULT_FAIL_SEVERITIES,
    compute_control_status,
    severity_breakdown,
)
from app.services.coverage_overrides import (
    get_coverage_override_details,
    get_coverage_overrides,
)
from app.services.cross_account_coverage import (
    absence_checks,
    cross_account_coverable_checks,
    get_cross_account_coverage,
)

_DEFINITIONS_PATH = Path(__file__).parent.parent.parent / "data" / "composite_controls.json"


@lru_cache(maxsize=1)
def composite_control_definitions() -> list[dict[str, Any]]:
    return json.loads(_DEFINITIONS_PATH.read_text())


def _checks_in_control_mappings() -> set[str]:
    from app.services.check_controls import _mapping_entries

    out: set[str] = set()
    for entry in _mapping_entries():
        out.update(entry.get("checks", []))
    return out


def checks_in_composites() -> set[str]:
    out: set[str] = set()
    for entry in composite_control_definitions():
        out.update(entry.get("checks", []))
    return out


def control_mapping_checks_missing_from_composites() -> list[str]:
    """Checks referenced in control_mappings.json but absent from every composite."""
    return sorted(_checks_in_control_mappings() - checks_in_composites())


def assert_control_mapping_composite_coverage() -> None:
    missing = control_mapping_checks_missing_from_composites()
    if missing:
        raise ValueError(
            "control_mappings.json includes checks with no composite roll-up: "
            + ", ".join(missing)
        )


def soc2_control_checks(control_id: str, *, org_id: uuid.UUID | None = None, db: Session | None = None) -> list[str]:
    from app.services.check_controls import global_control_checks
    from app.services.org_control_mappings import effective_checks_for_control

    global_checks = global_control_checks("soc2", control_id)
    return effective_checks_for_control(db, org_id, "soc2", control_id, global_checks)


# Primary composite when a check rolls up to multiple composites (Finding Drawer / by-check API).
_PRIMARY_COMPOSITE_BY_CHECK: dict[str, str] = {
    # Asset inventory (CC6.1) vs broader identity governance
    "iam.user.credentials_unused_45d": "asset_inventory",
    "iam.role.unassumed_90d": "asset_inventory",
    "iam.access_key.unused_45d": "asset_inventory",
    "iam.access_inventory_gap": "asset_inventory",
    "github.org.dormant_members": "asset_inventory",
    "gitlab.org.dormant_members": "asset_inventory",
    "identity_center.user.inactive_90d": "asset_inventory",
    "google_workspace.user.inactive_90d": "asset_inventory",
    "entra.user.inactive_90d": "asset_inventory",
    "okta.user.inactive_90d": "asset_inventory",
    # Secure SDLC vs change management
    "github.repo.no_branch_protection": "secure_sdlc",
    "gitlab.repo.no_branch_protection": "secure_sdlc",
    "github.repo.self_merge_allowed": "secure_sdlc",
    "gitlab.repo.self_merge_allowed": "secure_sdlc",
    "github.repo.insufficient_reviews": "secure_sdlc",
    "gitlab.repo.insufficient_reviews": "secure_sdlc",
    "github.repo.no_env_protection": "change_management",
    "gitlab.repo.no_env_protection": "change_management",
    # CloudTrail: logging vs change management
    "cloudtrail.trail.not_enabled": "logging_monitoring",
    "cloudtrail.trail.no_log_validation": "logging_monitoring",
    "cloudtrail.event.trail_tampering": "logging_monitoring",
    "cloudtrail.event.lambda_function_created_or_modified": "change_management",
    "cloudtrail.event.rds_instance_created_or_modified": "change_management",
    # Vulnerability: container-scoped vs account-wide
    "aws.vulnerability_monitoring.not_detected": "container_vulnerability_monitoring",
    "ecr.registry.enhanced_scanning_disabled": "container_vulnerability_monitoring",
    "ecr.repository.image_scan_disabled": "container_vulnerability_monitoring",
    "aws.inspector.active_critical_finding": "vulnerability_management",
    "scanner.wiz.open_finding": "vulnerability_management",
    "scanner.tenable.open_finding": "vulnerability_management",
    "scanner.qualys.open_finding": "vulnerability_management",
    "scanner.snyk.open_finding": "vulnerability_management",
    "scanner.orca.open_finding": "vulnerability_management",
    "scanner.aikido.open_finding": "vulnerability_management",
    # Data protection vs logging for CloudTrail events
    "cloudtrail.event.kms_key_disabled_or_deleted": "data_protection",
    "cloudtrail.event.s3_bucket_policy_change": "data_protection",
    "ec2.instance.no_instance_profile": "identity_governance",
    "backup.plan.missing": "backup_resilience",
    # Network boundary owns exposure checks (also listed under data protection
    # and backup for criteria roll-up).
    "cloudtrail.event.s3_public_access_block_disabled": "network_boundary",
    "cloudtrail.event.security_group_open_to_world": "network_boundary",
    "ec2.ami.public": "network_boundary",
    "ec2.ebs.snapshot_public": "network_boundary",
    "ec2.instance.imdsv2_not_required": "network_boundary",
    "ec2.security_group.default_allows_traffic": "network_boundary",
    "ec2.security_group.unrestricted_rdp": "network_boundary",
    "ec2.security_group.unrestricted_ssh": "network_boundary",
    "ecs.service.public_ip_enabled": "network_boundary",
    "eks.cluster.public_endpoint": "network_boundary",
    "lambda.function.public_url": "network_boundary",
    "rds.instance.publicly_accessible": "network_boundary",
    "rds.snapshot.public": "network_boundary",
    "s3.account.public_access_not_blocked": "network_boundary",
    "s3.bucket.public_access_not_blocked": "network_boundary",
    "azure.storage.public_blob_access": "network_boundary",
    "azure.compute.instance_public_ip": "network_boundary",
    "gcp.compute.instance_public_ip": "network_boundary",
    "gcp.firewall.open_ingress": "network_boundary",
    "gcp.asset.public_iam_binding": "network_boundary",
    "gcp.asset.public_invoker": "network_boundary",
    "azure.entra.privileged_role_assignment": "identity_governance",
    "azure.policy.non_compliant": "logging_monitoring",
    "gcp.osconfig.vuln_report_present": "vulnerability_management",
    "gcp.scc.not_enabled": "incident_response",
    # Flow logs stay attributed to logging even though the network composite
    # rolls them up for CC6 coverage.
    "vpc.flow_logs.not_enabled": "logging_monitoring",
    # Incident response owns detection-service posture (also under logging).
    "aws.securityhub.not_enabled": "incident_response",
    "cloudtrail.event.guardduty_disabled": "incident_response",
    "guardduty.detector.not_enabled": "incident_response",
    "guardduty.open_findings": "incident_response",
    "intune.device.not_encrypted": "mdm_endpoint",
    "jamf.device.not_encrypted": "mdm_endpoint",
    "okta.app.overprivileged_grant": "identity_governance",
    "okta.service.api_token_stale": "identity_governance",
}


def _infer_primary_composite_id(mapped_id: str) -> str | None:
    matches = [
        entry["id"]
        for entry in composite_control_definitions()
        if mapped_id in entry.get("checks", [])
    ]
    if len(matches) == 1:
        return matches[0]
    return None


def primary_composite_id_for_check(check_id: str) -> str | None:
    from app.services.check_controls import resolve_check_id_for_controls

    mapped_id = resolve_check_id_for_controls(check_id)
    return _PRIMARY_COMPOSITE_BY_CHECK.get(mapped_id) or _infer_primary_composite_id(mapped_id)


def _composite_summary(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entry["id"],
        "control_id": entry["control_id"],
        "title": entry["title"],
        "description": entry.get("description", ""),
        "guidance": entry.get("guidance"),
        "soc2_criteria": list(entry.get("soc2_criteria") or []),
        "cis_criteria": list(entry.get("cis_criteria") or []),
        "iso_criteria": list(entry.get("iso_criteria") or []),
    }


def composite_defs_for_check(
    check_id: str,
    *,
    org_id: uuid.UUID | None = None,
    db: Session | None = None,
) -> list[dict[str, Any]]:
    """Composite control definitions that include this check_id, primary first."""
    from app.services.check_controls import resolve_check_id_for_controls
    from app.services.org_control_mappings import effective_composite_check_ids, load_org_mapping_index

    mapped_id = resolve_check_id_for_controls(check_id)
    mapping_index = load_org_mapping_index(db, org_id) if org_id and db else None
    rows: list[dict[str, Any]] = []
    for entry in composite_control_definitions():
        if mapping_index is not None and org_id and db:
            effective = effective_composite_check_ids(db, org_id, entry, mapping_index=mapping_index)
        else:
            effective = list(entry.get("checks") or [])
        if mapped_id not in effective:
            continue
        rows.append(_composite_summary(entry))

    preferred_id = primary_composite_id_for_check(check_id)
    if preferred_id:
        rows.sort(key=lambda r: (0 if r["id"] == preferred_id else 1, r["id"]))
    else:
        rows.sort(key=lambda r: r["id"])
    return rows


def _scan_context(
    db: Session,
    org_id: uuid.UUID,
    account_id: uuid.UUID | None,
    hidden: set[str],
) -> tuple[dict[str, list[Finding]], set[str], set[str], bool, list[dict[str, Any]]]:
    open_by_check: dict[str, list[Finding]] = {}
    latest_checks_run: set[str] = set()
    latest_failed_checks: set[str] = set()
    scan_check_errors: list[dict[str, Any]] = []
    has_scanned_account = False

    # Source control is org-level (findings have account_id=NULL) and is graded
    # off git sync, not a cloud scan — load it regardless of the selected cloud
    # account so Secure SDLC works even with no cloud account connected.
    source_control_synced = load_source_control_grading_context(
        db, org_id, open_by_check, latest_checks_run, hidden
    )
    integration_synced = load_integration_sync_grading_context(
        db, org_id, open_by_check, latest_checks_run, hidden
    )
    org_integrations_synced = source_control_synced or integration_synced

    if not account_id:
        return open_by_check, latest_checks_run, latest_failed_checks, org_integrations_synced, scan_check_errors

    acc = db.get(AwsAccount, account_id)
    if not acc or acc.org_id != org_id:
        return open_by_check, latest_checks_run, latest_failed_checks, org_integrations_synced, scan_check_errors

    open_q = select(Finding).where(
        Finding.account_id == account_id,
        Finding.status == "open",
    )
    if hidden:
        open_q = open_q.where(Finding.check_id.notin_(hidden))
    for finding in db.scalars(open_q).all():
        open_by_check.setdefault(finding.check_id, []).append(finding)

    latest_run = db.scalars(
        select(ScanRun)
        .where(
            ScanRun.account_id == account_id,
            ScanRun.status.in_(("ok", "degraded")),
            ScanRun.finished_at.isnot(None),
        )
        .order_by(ScanRun.finished_at.desc())
        .limit(1)
    ).first()
    run_stats = latest_run.stats if latest_run and isinstance(latest_run.stats, dict) else {}
    latest_checks_raw = run_stats.get("checks_run") if isinstance(run_stats, dict) else None
    if isinstance(latest_checks_raw, list):
        # Merge, don't replace: org-level checks (source-control + identity
        # integrations) were already marked run by the load_*_grading_context
        # calls above. Reassigning here would wipe them, so an org composite
        # would show "coverage gap" whenever a cloud account is selected.
        latest_checks_run |= {str(cid) for cid in latest_checks_raw}
    errors_raw = run_stats.get("check_errors") if isinstance(run_stats, dict) else None
    if isinstance(errors_raw, list):
        for err in errors_raw:
            if isinstance(err, dict) and err.get("check_id"):
                cid = str(err["check_id"])
                latest_failed_checks.add(cid)
                scan_check_errors.append(
                    {
                        "check_id": cid,
                        "error_type": err.get("error_type"),
                        "error": (err.get("error") or "")[:300],
                    }
                )

    has_scanned_account = bool(acc.last_scan_at)
    # "Scanned" for a source-control-only composite means a git sync ran; for a
    # cloud composite the per-check `all_mapped_checks_ran` gate still requires
    # the cloud checks to be present, so this OR can't vacuously pass them.
    return (
        open_by_check,
        latest_checks_run,
        latest_failed_checks,
        has_scanned_account or org_integrations_synced,
        scan_check_errors,
    )


def load_source_control_grading_context(
    db: Session,
    org_id: uuid.UUID,
    open_by_check: dict[str, list[Finding]],
    latest_checks_run: set[str],
    hidden: set[str],
) -> bool:
    """Load org-scoped source-control findings + mark those checks 'run'.

    Returns True if a github/gitlab provider has completed a sync (the
    source-control equivalent of "has been scanned"). When synced, every
    source-control check for that provider type counts as run — so a clean
    repo set grades ``pass`` and an unprotected repo grades ``fail``, while a
    provider that is not connected at all stays ``no_data`` (not a vacuous pass).
    """
    providers = db.scalars(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type.in_(("github", "gitlab")),
        )
    ).all()
    active_prefixes: set[str] = set()
    synced = False
    for provider in providers:
        if provider.last_synced_at is None or provider.status != "connected":
            continue
        synced = True
        active_prefixes.add(f"{provider.type}.")
        for mod in source_control_checks_for(provider.type):
            latest_checks_run.add(mod.CHECK_ID)
    if not synced:
        return False

    q = select(Finding).where(
        Finding.org_id == org_id,
        Finding.account_id.is_(None),
        Finding.status == "open",
    )
    if hidden:
        q = q.where(Finding.check_id.notin_(hidden))
    for finding in db.scalars(q).all():
        if is_source_control_check(finding.check_id) and any(
            finding.check_id.startswith(prefix) for prefix in active_prefixes
        ):
            open_by_check.setdefault(finding.check_id, []).append(finding)
    return True


_INTEGRATION_EVIDENCE_PROVIDER_TYPES = (
    "okta",
    "entra_id",
    "google_workspace",
    "github",
    "gitlab",
)

_PROVIDER_EVIDENCE_LABELS: dict[str, str] = {
    "okta": "Okta",
    "entra_id": "Entra ID",
    "google_workspace": "Google Workspace",
    "github": "GitHub",
    "gitlab": "GitLab",
}


def _check_prefix_for_evidence_provider(provider_type: str) -> str:
    if provider_type in ("github", "gitlab"):
        return f"{provider_type}."
    from app.services.integration_sync_scan import check_prefix_for_provider_type

    return f"{check_prefix_for_provider_type(provider_type)}."


def evidence_integrations_for_check_ids(
    check_ids: list[str],
    providers: list[IdentityProvider],
) -> list[dict[str, Any]]:
    """Connected integrations whose check prefixes intersect a composite's checks."""
    out: list[dict[str, Any]] = []
    for provider in providers:
        if provider.last_synced_at is None:
            continue
        prefix = _check_prefix_for_evidence_provider(provider.type)
        if not any(cid.startswith(prefix) for cid in check_ids):
            continue
        api_type = "entra" if provider.type == "entra_id" else provider.type
        synced_at = provider.last_synced_at
        out.append(
            {
                "type": api_type,
                "label": _PROVIDER_EVIDENCE_LABELS.get(provider.type, provider.type),
                "connected": provider.status == "connected",
                "last_synced_at": synced_at.isoformat() if synced_at else None,
            }
        )
    return sorted(out, key=lambda row: row["label"].lower())


def load_integration_sync_grading_context(
    db: Session,
    org_id: uuid.UUID,
    open_by_check: dict[str, list[Finding]],
    latest_checks_run: set[str],
    hidden: set[str],
) -> bool:
    """Load org-scoped identity integration findings + mark those checks 'run'.

    Returns True if okta/entra_id/google_workspace has completed a sync.
    """
    from app.services.integration_sync_scan import check_prefix_for_provider_type

    providers = db.scalars(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type.in_(("okta", "entra_id", "google_workspace")),
        )
    ).all()
    active_prefixes: set[str] = set()
    synced = False
    for provider in providers:
        if provider.last_synced_at is None or provider.status != "connected":
            continue
        synced = True
        prefix = check_prefix_for_provider_type(provider.type)
        active_prefixes.add(f"{prefix}.")
        for mod in integration_sync_checks_for(prefix):
            latest_checks_run.add(mod.CHECK_ID)
    if not synced:
        return False

    q = select(Finding).where(
        Finding.org_id == org_id,
        Finding.account_id.is_(None),
        Finding.status == "open",
    )
    if hidden:
        q = q.where(Finding.check_id.notin_(hidden))
    for finding in db.scalars(q).all():
        if is_integration_sync_check(finding.check_id) and any(
            finding.check_id.startswith(prefix) for prefix in active_prefixes
        ):
            open_by_check.setdefault(finding.check_id, []).append(finding)
    return True


_VALID_SEVERITIES = frozenset({"critical", "high", "medium", "low"})


def _fail_severities(settings: dict[str, Any] | None) -> frozenset[str]:
    """Org-configurable severities that fail a control. Defaults to crit/high."""
    raw = (settings or {}).get("compliance_thresholds")
    if isinstance(raw, dict):
        sev = raw.get("fail_severities")
        if isinstance(sev, list):
            valid = {str(s).lower() for s in sev if str(s).lower() in _VALID_SEVERITIES}
            if valid:
                return frozenset(valid)
    return DEFAULT_FAIL_SEVERITIES


def _cross_account_scan_contexts(
    db: Session,
    org_id: uuid.UUID,
    hidden: set[str],
    coverage: dict[str, dict[str, Any]],
) -> dict[str, tuple[dict[str, list[Finding]], set[str]] | None]:
    """For each AWS account referenced by cross-account coverage, return its
    latest (open-finding map, executed-check set), or None if it isn't a
    connected, scanned account in this org. Used to auto-verify that the
    capability is actually on in that account — no manual step."""
    out: dict[str, tuple[dict[str, list[Finding]], set[str]] | None] = {}
    referenced = {d.get("account_id") for d in coverage.values() if d.get("account_id")}
    for acct_num in referenced:
        if not acct_num:
            continue
        acct = db.execute(
            select(AwsAccount).where(
                AwsAccount.org_id == org_id,
                AwsAccount.account_id == acct_num,
                AwsAccount.status == "connected",
            )
        ).scalar_one_or_none()
        if acct is not None and acct.last_scan_at is not None:
            open_by_check, ran, _failed, has_scanned, _errors = _scan_context(
                db, org_id, acct.id, hidden
            )
            out[acct_num] = (open_by_check, ran) if has_scanned else None
        else:
            out[acct_num] = None
    return out


def _cross_account_detail(
    coverage_entry: dict[str, Any] | None,
    check_ids: list[str],
    contexts: dict[str, tuple[dict[str, list[Finding]], set[str]] | None],
) -> dict[str, Any] | None:
    """Augment a stored cross-account entry with a live ``verified`` flag: True
    when the referenced account's latest scan ran the capability's checks and
    found them clean (i.e. the service really is on there)."""
    if not coverage_entry:
        return None
    detail = dict(coverage_entry)
    ctx = contexts.get(detail.get("account_id"))
    verified = False
    if ctx is not None:
        open_by_check, ran = ctx
        # Verify the capability that's actually cross-account coverable.
        targets = cross_account_coverable_checks(check_ids) or absence_checks(check_ids)
        verified = bool(targets) and all(
            (c in ran) and not open_by_check.get(c) for c in targets
        )
    detail["verified"] = verified
    return detail


def list_composite_controls(
    db: Session,
    org_id: uuid.UUID,
    account_id: uuid.UUID | None,
) -> list[dict[str, Any]]:
    org = db.get(Org, org_id)
    fail_severities = _fail_severities(org.settings if org else {})
    hidden = hidden_check_ids(org.settings if org else {})
    coverage_overrides = get_coverage_overrides(org.settings if org else {})
    coverage_override_details = get_coverage_override_details(org.settings if org else {})
    cross_account_coverage = get_cross_account_coverage(org.settings if org else {})
    cross_account_ctx = _cross_account_scan_contexts(db, org_id, hidden, cross_account_coverage)
    open_by_check, latest_checks_run, latest_failed_checks, has_scanned_account, scan_check_errors = _scan_context(
        db, org_id, account_id, hidden
    )

    # Capability-level attestation: when the org declares an external scanner,
    # suppress the scanning-family findings (they stay "ran", so they grade as
    # covered rather than no_data) while intrinsic repo controls remain live.
    from app.services.scanning_attestation import (
        ATTESTABLE_SCANNING_CHECKS,
        get_scanning_attestation,
    )

    scanning_attestation = get_scanning_attestation(org.settings if org else {})
    if scanning_attestation:
        for cid in ATTESTABLE_SCANNING_CHECKS:
            open_by_check.pop(cid, None)

    errors_by_check = {e["check_id"]: e for e in scan_check_errors}
    from app.services.sdlc_evidence import sdlc_insights_for_org

    from app.services.org_control_mappings import effective_composite_check_ids, load_org_mapping_index
    from app.models.evidence_artifact import EvidenceArtifact
    from app.services.category_evidence_coverage import resolve_composite_display_status
    from app.services.evidence_source_registry import category_for_composite
    from app.services.evidence_source_store import load_evidence_sources

    sdlc_insights = sdlc_insights_for_org(db, org_id)
    mapping_index = load_org_mapping_index(db, org_id)
    evidence_registry = load_evidence_sources(db, org_id)
    accepted_composite_ids = {
        row.composite_control_id
        for row in db.scalars(
            select(EvidenceArtifact).where(
                EvidenceArtifact.org_id == org_id,
                EvidenceArtifact.status == "accepted",
            )
        ).all()
        if row.composite_control_id
    }
    integration_providers = db.scalars(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type.in_(_INTEGRATION_EVIDENCE_PROVIDER_TYPES),
        )
    ).all()

    result: list[dict[str, Any]] = []
    for entry in composite_control_definitions():
        base_check_ids = effective_composite_check_ids(db, org_id, entry, mapping_index=mapping_index)
        check_ids = [cid for cid in base_check_ids if cid not in hidden]
        status, open_hits, finding_count = compute_control_status(
            check_ids,
            open_by_check,
            latest_checks_run,
            latest_failed_checks,
            has_scanned_account=has_scanned_account,
            fail_severities=fail_severities,
        )
        cov_tier = control_coverage_tier(check_ids)
        check_tiers = {cid: tier_for_check(cid) for cid in check_ids}
        cross_account_detail = _cross_account_detail(
            cross_account_coverage.get(entry["id"]), check_ids, cross_account_ctx
        )
        cat_key = category_for_composite(entry["id"])
        registry_entry = evidence_registry.get(cat_key) if cat_key else None
        registry_vendor = registry_entry.get("vendor") if registry_entry else None
        display_status = resolve_composite_display_status(
            entry["id"],
            status=status,
            check_ids=check_ids,
            check_tiers=check_tiers,
            has_accepted=entry["id"] in accepted_composite_ids,
            registry_vendor=registry_vendor,
            open_by_check=open_by_check,
            coverage_override=coverage_overrides.get(entry["id"]),
            cross_account_verified=bool(cross_account_detail and cross_account_detail.get("verified")),
        )
        row: dict[str, Any] = {
                "id": entry["id"],
                "control_id": entry["control_id"],
                "title": entry["title"],
                "description": entry.get("description", ""),
                "guidance": entry.get("guidance"),
                "soc2_criteria": list(entry.get("soc2_criteria") or []),
                "cis_criteria": list(entry.get("cis_criteria") or []),
                "iso_criteria": list(entry.get("iso_criteria") or []),
                "check_ids": check_ids,
                "coverage_tier": cov_tier,
                "coverage_label": tier_display_label(cov_tier),
                "extended_check_ids": extended_checks_in_list(check_ids),
                "check_tiers": check_tiers,
                "check_evidence_classes": {cid: evidence_class_for_check(cid) for cid in check_ids},
                "status": status,
                "display_status": display_status,
                "evidence_category_key": cat_key,
                "registry_vendor": registry_vendor,
                "finding_count": finding_count,
                "severity_counts": severity_breakdown(open_hits),
                "open_finding_ids": [str(f.id) for f in open_hits],
                "scan_errors": [errors_by_check[cid] for cid in check_ids if cid in errors_by_check],
                "coverage_override": coverage_overrides.get(entry["id"]),
                "coverage_override_detail": coverage_override_details.get(entry["id"]),
                "cross_account_coverage_detail": cross_account_detail,
                "evidence_integrations": evidence_integrations_for_check_ids(
                    check_ids, integration_providers
                ),
            }
        if entry["id"] == "secure_sdlc":
            row["sdlc_insights"] = sdlc_insights
            row["scanning_attestation"] = scanning_attestation
            row["scanning_attestable_checks"] = sorted(
                cid for cid in check_ids if cid in ATTESTABLE_SCANNING_CHECKS
            )
        result.append(row)
    return result
