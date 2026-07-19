"""Normalize optional scanner sync into capability envelopes (Phase 5).

Vendor absence never fails a lane. Native evidence can satisfy without scanners.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.services.technical_capability import (
    CapabilityId,
    CoverageCounts,
    EvidenceEnvelope,
    OpenFindingsSummary,
    envelope,
)

# Which lanes each optional scanner may satisfy when findings/coverage exist.
SCANNER_LANE_MAP: dict[str, list[CapabilityId]] = {
    "snyk": ["dependency_scanning", "source_code_scanning", "container_image_scanning"],
    "aikido": ["dependency_scanning", "source_code_scanning"],
    "wiz": ["host_workload_scanning", "container_image_scanning", "cloud_findings_posture"],
    "orca": ["host_workload_scanning", "container_image_scanning", "cloud_findings_posture"],
    "tenable": ["host_workload_scanning", "cloud_findings_posture"],
    "qualys": ["host_workload_scanning", "cloud_findings_posture"],
}


def vendor_key(provider_type: str | None) -> str:
    raw = (provider_type or "").strip().lower()
    return raw.removeprefix("scanner_")


def build_scanner_capability_evidence(
    vendor: str,
    *,
    open_findings_count: int,
    last_synced_at: str | None = None,
    asset_count: int | None = None,
    severity_counts: dict[str, int] | None = None,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Produce capability_evidence rows stored on IdentityProvider config after sync."""
    ref = now or datetime.now(timezone.utc)
    key = vendor_key(vendor)
    lanes = SCANNER_LANE_MAP.get(key, ["host_workload_scanning"])
    synced = last_synced_at or ref.isoformat()
    sev = severity_counts or {}
    counted = sum(int(sev.get(k) or 0) for k in ("critical", "high", "medium"))
    open_findings = OpenFindingsSummary(
        critical=int(sev.get("critical") or 0),
        high=int(sev.get("high") or 0),
        medium=int(sev.get("medium") or 0),
        low=int(sev.get("low") or max(0, open_findings_count - counted)),
    )
    denominator_known = asset_count is not None
    eligible = max(int(asset_count or 0), 1)
    has_activity = open_findings_count > 0 or (asset_count is not None and asset_count > 0)
    limitations: list[str] = []
    if not has_activity:
        limitations.append("scanner_connected_without_assessed_assets")
    if not denominator_known:
        limitations.append("asset_denominator_not_collected")
    rows: list[dict[str, Any]] = []
    for lane in lanes:
        env = envelope(
            capability=lane,
            provider=key,
            scope_type="tenant",
            scope_id=key,
            asset_type="scanner_inventory",
            enabled=True,
            has_observable_activity=has_activity,
            last_observed_at=synced,
            last_successful_scan_at=synced if has_activity else None,
            eligible=eligible,
            assessed=eligible if has_activity and denominator_known else 0,
            open_findings=open_findings,
            source_reference=f"scanner:{key}:{lane}",
            limitations=list(limitations),
            now=ref,
        )
        rows.append(env.as_dict())
    return rows


def envelopes_from_scanner_config(
    provider_type: str,
    cfg: dict[str, Any],
    *,
    now: datetime | None = None,
) -> list[EvidenceEnvelope]:
    ref = now or datetime.now(timezone.utc)
    key = vendor_key(provider_type)
    raw = cfg.get("capability_evidence")
    if isinstance(raw, list) and raw:
        out: list[EvidenceEnvelope] = []
        for row in raw:
            if not isinstance(row, dict):
                continue
            of = row.get("open_findings") if isinstance(row.get("open_findings"), dict) else {}
            cov = row.get("coverage") if isinstance(row.get("coverage"), dict) else {}
            out.append(
                EvidenceEnvelope(
                    capability=row.get("capability") or "host_workload_scanning",  # type: ignore[arg-type]
                    provider=str(row.get("provider") or key),
                    scope_type=str(row.get("scope_type") or "tenant"),
                    scope_id=str(row.get("scope_id") or key),
                    asset_type=str(row.get("asset_type") or "scanner_inventory"),
                    status=row.get("status") or "unknown",  # type: ignore[arg-type]
                    enabled=bool(row.get("enabled")),
                    last_observed_at=row.get("last_observed_at"),
                    last_successful_scan_at=row.get("last_successful_scan_at"),
                    coverage=CoverageCounts(
                        eligible=int(cov.get("eligible") or 0),
                        assessed=int(cov.get("assessed") or 0),
                        excluded=int(cov.get("excluded") or 0),
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
            )
        return out

    count = int(cfg.get("open_findings_count") or 0)
    if not cfg.get("last_synced_at") and count == 0:
        return []
    return [
        envelope(
            capability=lane,
            provider=key,
            scope_type="tenant",
            scope_id=key,
            asset_type="scanner_inventory",
            enabled=True,
            has_observable_activity=count > 0,
            last_observed_at=cfg.get("last_synced_at"),
            last_successful_scan_at=cfg.get("last_synced_at") if count > 0 else None,
            eligible=1,
            assessed=1 if count > 0 else 0,
            open_findings=OpenFindingsSummary(high=count),
            source_reference=f"scanner:{key}:legacy",
            limitations=["legacy_sync_summary_only"] if count == 0 else [],
            now=ref,
        )
        for lane in SCANNER_LANE_MAP.get(key, ["host_workload_scanning"])
    ]
