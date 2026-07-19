"""Operational evidence grading for SIEM / monitoring / incident ops (Phase 3).

Separate from vulnerability capability lanes. Connected-but-unconfigured never
false-verifies. PagerDuty is incident operations only — never threat detection.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.github import IdentityProvider
from app.services.github_sync import provider_config
from app.services.pagerduty_integration import PAGERDUTY_PROVIDER_TYPE
from app.services.siem_integrations import SIEM_TYPES
from app.services.technical_capability import (
    CoverageCounts,
    CoverageState,
    EvidenceEnvelope,
    OpenFindingsSummary,
    grade_from_enablement_and_activity,
    merge_lane_states,
)

OperationalCapabilityId = Literal[
    "logging_monitoring",
    "threat_detection_signals",
    "incident_operations",
]

OPERATIONAL_LABELS: dict[OperationalCapabilityId, str] = {
    "logging_monitoring": "Logging & monitoring signals",
    "threat_detection_signals": "Threat detection signals",
    "incident_operations": "Incident operations",
}


def grade_siem_from_config(
    vendor: str,
    cfg: dict[str, Any],
    *,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Build normalized capability_evidence rows for SIEM sync persistence."""
    ref = now or datetime.now(timezone.utc)
    now_iso = ref.isoformat()
    key = vendor.lower()
    signal_count = int(cfg.get("signal_count") or 0)
    logging_event_count = int(cfg.get("logging_event_count") or signal_count)
    security_signal_count = int(cfg.get("security_signal_count") or 0)
    last_synced = cfg.get("last_synced_at") or now_iso
    index_or_source = (
        cfg.get("index")
        or cfg.get("security_index")
        or cfg.get("cluster_url")
        or cfg.get("site")
        or "default"
    )
    has_rules = bool(
        cfg.get("security_rules_enabled") or cfg.get("monitor_count") or cfg.get("has_security_index")
    )
    configured = bool(
        cfg.get("index") or cfg.get("has_security_index") or cfg.get("site") or cfg.get("cluster_url")
    )
    has_activity = security_signal_count > 0 and has_rules
    limitations: list[str] = []
    if configured and not has_activity:
        limitations.append("connected_without_security_signals")
    if key == "elastic" and not cfg.get("has_security_index") and signal_count == 0:
        limitations.append("generic_elasticsearch_not_security_solution")
    if key == "datadog" and not cfg.get("security_rules_enabled") and signal_count == 0:
        limitations.append("base_datadog_without_cloud_siem_signals")
    if key == "splunk" and not cfg.get("index"):
        limitations.append("splunk_index_not_configured")
    if cfg.get("security_detection_unassessed"):
        limitations.append("security_detection_rules_not_collected")

    return [
        {
            "capability": "logging_monitoring",
            "provider": f"siem_{key}",
            "scope_type": "tenant",
            "scope_id": str(index_or_source),
            "asset_type": "log_source",
            "enabled": configured,
            "has_observable_activity": logging_event_count > 0 or bool(cfg.get("ingestion_fresh")),
            "last_observed_at": last_synced,
            "last_successful_scan_at": last_synced if logging_event_count > 0 else None,
            "eligible": 1,
            "assessed": 1 if logging_event_count > 0 else 0,
            "open_findings": {"critical": 0, "high": 0, "medium": 0, "low": 0},
            "source_reference": f"siem:{key}:logging",
            "limitations": list(limitations),
        },
        {
            "capability": "threat_detection_signals",
            "provider": f"siem_{key}",
            "scope_type": "tenant",
            "scope_id": str(index_or_source),
            "asset_type": "detection_rule",
            "enabled": configured and has_rules,
            "has_observable_activity": has_activity,
            "last_observed_at": last_synced,
            "last_successful_scan_at": last_synced if has_activity else None,
            "eligible": 1,
            "assessed": 1 if has_activity else 0,
            "open_findings": {
                "critical": int(cfg.get("critical_signals") or 0),
                "high": int(cfg.get("high_signals") or 0),
                "medium": 0,
                "low": max(
                    0,
                    security_signal_count
                    - int(cfg.get("critical_signals") or 0)
                    - int(cfg.get("high_signals") or 0),
                ),
            },
            "source_reference": f"siem:{key}:detection",
            "limitations": list(limitations),
        },
    ]


def grade_pagerduty_from_config(
    cfg: dict[str, Any],
    *,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """PagerDuty → incident_operations only (never threat detection)."""
    ref = now or datetime.now(timezone.utc)
    last_synced = cfg.get("last_synced_at") or ref.isoformat()
    services = int(cfg.get("service_count") or 0)
    schedules = int(cfg.get("schedule_count") or 0)
    escalations = int(cfg.get("escalation_policy_count") or 0)
    open_incidents = int(cfg.get("open_incident_count") or 0)
    acknowledged = int(cfg.get("acknowledged_incident_count") or 0)
    resolved_recent = int(cfg.get("resolved_incident_count_7d") or 0)
    configured = services > 0 or schedules > 0 or escalations > 0
    has_activity = open_incidents > 0 or acknowledged > 0 or resolved_recent > 0
    limitations: list[str] = ["not_threat_detection"]
    if not configured:
        limitations.append("no_services_or_schedules")
    elif not has_activity:
        limitations.append("services_configured_without_incident_activity")
    return [
        {
            "capability": "incident_operations",
            "provider": "pagerduty",
            "scope_type": "tenant",
            "scope_id": "pagerduty",
            "asset_type": "oncall_service",
            "enabled": configured,
            "has_observable_activity": has_activity,
            "last_observed_at": last_synced,
            "last_successful_scan_at": last_synced if configured else None,
            "eligible": max(services, 1 if configured else 0),
            "assessed": services if configured else 0,
            "open_findings": {
                "critical": open_incidents,
                "high": acknowledged,
                "medium": 0,
                "low": 0,
            },
            "source_reference": "pagerduty:incident_operations",
            "limitations": limitations,
        }
    ]


def _status_from_row(row: dict[str, Any], now: datetime) -> CoverageState:
    capability = str(row.get("capability") or "logging_monitoring")
    return grade_from_enablement_and_activity(
        enabled=row.get("enabled"),
        has_observable_activity=bool(row.get("has_observable_activity")),
        last_successful_scan_at=row.get("last_successful_scan_at") or row.get("last_observed_at"),
        capability=capability,  # type: ignore[arg-type]
        eligible=int(row.get("eligible") or 1),
        assessed=int(row.get("assessed") or 0),
        now=now,
    )


def _envelope_from_row(row: dict[str, Any], *, now: datetime) -> EvidenceEnvelope:
    of = row.get("open_findings") if isinstance(row.get("open_findings"), dict) else {}
    return EvidenceEnvelope(
        capability=row["capability"],  # type: ignore[arg-type]
        provider=str(row["provider"]),
        scope_type=str(row.get("scope_type") or "tenant"),
        scope_id=str(row.get("scope_id") or "default"),
        asset_type=str(row.get("asset_type") or "operational"),
        status=_status_from_row(row, now),
        enabled=bool(row.get("enabled")),
        last_observed_at=row.get("last_observed_at"),
        last_successful_scan_at=row.get("last_successful_scan_at"),
        coverage=CoverageCounts(
            eligible=int(row.get("eligible") or 0),
            assessed=int(row.get("assessed") or 0),
        ),
        open_findings=OpenFindingsSummary(
            critical=int(of.get("critical") or 0),
            high=int(of.get("high") or 0),
            medium=int(of.get("medium") or 0),
            low=int(of.get("low") or 0),
        ),
        source_reference=row.get("source_reference"),
        limitations=list(row.get("limitations") or []),
    )


def _rows_from_provider(provider: IdentityProvider, *, now: datetime) -> list[dict[str, Any]]:
    cfg = provider_config(provider)
    stored = cfg.get("capability_evidence")
    if isinstance(stored, list) and stored:
        return [r for r in stored if isinstance(r, dict)]
    ptype = (provider.type or "").lower()
    if ptype == PAGERDUTY_PROVIDER_TYPE:
        return grade_pagerduty_from_config(cfg, now=now)
    if ptype.startswith("siem_"):
        return grade_siem_from_config(ptype.removeprefix("siem_"), cfg, now=now)
    return []


def build_operational_capability_coverage(
    db: Session,
    org_id: uuid.UUID,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    ref = now or datetime.now(timezone.utc)
    providers = list(
        db.scalars(
            select(IdentityProvider).where(
                IdentityProvider.org_id == org_id,
                IdentityProvider.type.in_(
                    (
                        SIEM_TYPES["splunk"],
                        SIEM_TYPES["datadog"],
                        SIEM_TYPES["elastic"],
                        PAGERDUTY_PROVIDER_TYPE,
                    )
                ),
            )
        ).all()
    )
    envelopes: list[EvidenceEnvelope] = []
    connected: set[str] = set()
    for provider in providers:
        for row in _rows_from_provider(provider, now=ref):
            envelopes.append(_envelope_from_row(row, now=ref))
        connected.add((provider.type or "").removeprefix("siem_").removeprefix("incident_"))

    lanes: dict[str, Any] = {}
    for cap in ("logging_monitoring", "threat_detection_signals", "incident_operations"):
        caps = [e for e in envelopes if str(e.capability) == cap]
        states = [e.status for e in caps]
        status: CoverageState = merge_lane_states(states) if caps else "unknown"
        limitations: list[str] = []
        for e in caps:
            if e.status in ("partial", "stale", "not_covered", "unknown"):
                for lim in e.limitations:
                    if lim not in limitations:
                        limitations.append(lim)
        lanes[cap] = {
            "capability": cap,
            "label": OPERATIONAL_LABELS[cap],  # type: ignore[index]
            "status": status,
            "providers": sorted({e.provider for e in caps}),
            "coverage": {
                "eligible": sum(e.coverage.eligible for e in caps),
                "assessed": sum(e.coverage.assessed for e in caps),
                "excluded": sum(e.coverage.excluded for e in caps),
            },
            "open_findings": {
                "critical": sum(e.open_findings.critical for e in caps),
                "high": sum(e.open_findings.high for e in caps),
                "medium": sum(e.open_findings.medium for e in caps),
                "low": sum(e.open_findings.low for e in caps),
            },
            "limitations": limitations[:8],
            "envelopes": [e.as_dict() for e in caps[:50]],
        }

    return {
        "generated_at": ref.isoformat(),
        "connected_providers": sorted(connected),
        "lanes": lanes,
    }
