"""Provider-equivalent technical capability lanes (Phase 0 semantics).

See docs/technical-evidence-coverage-spec.md. This module defines shared IDs,
coverage states, evidence envelopes, freshness policies, and rollup rules.
Collectors and UI attach later; customer-facing claims stay gated by shipped
grading.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from app.services.capability_limitations import (
    blocking_limitations,
    has_blocking_limitation,
    has_degrading_limitation,
    primary_limitation,
    serialize_limitations,
)

CoverageState = Literal[
    "covered",
    "partial",
    "unvalidated",
    "not_covered",
    "stale",
    "not_applicable",
    "unknown",
]

CollectionStatus = Literal[
    "complete",
    "partial",
    "failed",
    "permission_denied",
    "unavailable_by_plan",
]

AuditVerdict = Literal[
    "verified_technical_evidence",
    "partial_technical_evidence",
    "insufficient_evidence",
    "not_applicable",
]

CapabilityId = Literal[
    "dependency_scanning",
    "source_code_scanning",
    "secret_scanning",
    "ci_security_enforcement",
    "container_image_scanning",
    "host_workload_scanning",
    "serverless_scanning",
    "cloud_findings_posture",
    "finding_operations",
    "logging_monitoring",
    "threat_detection_signals",
    "incident_operations",
]

# Customer-facing Vulnerability Management rolls up from these internal lanes.
VULNERABILITY_MANAGEMENT_LANES: tuple[CapabilityId, ...] = (
    "dependency_scanning",
    "source_code_scanning",
    "secret_scanning",
    "container_image_scanning",
    "host_workload_scanning",
    "serverless_scanning",
    "cloud_findings_posture",
)

# Secure SDLC technical lanes (CI + source-control scanning).
SECURE_SDLC_LANES: tuple[CapabilityId, ...] = (
    "dependency_scanning",
    "source_code_scanning",
    "secret_scanning",
    "ci_security_enforcement",
)

CAPABILITY_LABELS: dict[CapabilityId, str] = {
    "dependency_scanning": "Dependency scanning (SCA)",
    "source_code_scanning": "Source-code scanning (SAST)",
    "secret_scanning": "Secret scanning",
    "ci_security_enforcement": "CI security enforcement",
    "container_image_scanning": "Container-image scanning",
    "host_workload_scanning": "Host/workload scanning",
    "serverless_scanning": "Serverless scanning",
    "cloud_findings_posture": "Cloud findings/posture",
    "finding_operations": "Finding operations",
    "logging_monitoring": "Logging & monitoring signals",
    "threat_detection_signals": "Threat detection signals",
    "incident_operations": "Incident operations",
}

# Default freshness windows per lane (days). Exceeding → stale when otherwise covered.
FRESHNESS_POLICY_DAYS: dict[CapabilityId, int] = {
    "dependency_scanning": 14,
    "source_code_scanning": 14,
    "secret_scanning": 14,
    "ci_security_enforcement": 14,
    "container_image_scanning": 14,
    "host_workload_scanning": 14,
    "serverless_scanning": 14,
    "cloud_findings_posture": 7,
    "finding_operations": 30,
    "logging_monitoring": 7,
    "threat_detection_signals": 7,
    "incident_operations": 30,
}

# Providers that may satisfy a lane. Absence of any named optional vendor never fails.
LANE_PROVIDERS: dict[CapabilityId, frozenset[str]] = {
    "dependency_scanning": frozenset(
        {
            "github_dependabot",
            "gitlab_dependency_scanning",
            "snyk",
            "amazon_inspector_code",
            "aikido",
        }
    ),
    "source_code_scanning": frozenset(
        {
            "github_codeql",
            "gitlab_sast",
            "amazon_inspector_code",
            "semgrep",
            "snyk",
        }
    ),
    "secret_scanning": frozenset(
        {
            "github_secret_scanning",
            "gitlab_secret_detection",
            "trufflehog",
            "gitleaks",
        }
    ),
    "ci_security_enforcement": frozenset(
        {
            "github_actions",
            "gitlab_pipelines",
        }
    ),
    "container_image_scanning": frozenset(
        {
            "amazon_inspector_ecr",
            "gitlab_container_scanning",
            "defender_containers",
            "snyk",
            "wiz",
            "aqua",
            "trivy",
        }
    ),
    "host_workload_scanning": frozenset(
        {
            "amazon_inspector_ec2",
            "gcp_osconfig",
            "gcp_scc",
            "defender_servers",
            "crowdstrike",
            "sentinelone",
            "tenable",
            "qualys",
            "wiz",
            "orca",
        }
    ),
    "serverless_scanning": frozenset(
        {
            "amazon_inspector_lambda",
            "amazon_inspector_lambda_code",
        }
    ),
    "cloud_findings_posture": frozenset(
        {
            "aws_security_hub",
            "amazon_inspector",
            "gcp_scc",
            "defender_for_cloud",
        }
    ),
    "finding_operations": frozenset(
        {
            "jira",
            "provider_native_workflow",
        }
    ),
    "logging_monitoring": frozenset({"siem_splunk", "siem_datadog", "siem_elastic"}),
    "threat_detection_signals": frozenset(
        {"siem_splunk", "siem_datadog", "siem_elastic"}
    ),
    "incident_operations": frozenset({"pagerduty"}),
}

OPTIONAL_THIRD_PARTY_SCANNERS = frozenset(
    {"snyk", "wiz", "tenable", "qualys", "orca", "aikido", "aqua", "trivy", "semgrep"}
)

PASSING_STATES: frozenset[CoverageState] = frozenset({"covered", "not_applicable"})
FAILING_ACTION_STATES: frozenset[CoverageState] = frozenset(
    {"partial", "unvalidated", "not_covered", "stale"}
)


@dataclass
class CoverageCounts:
    eligible: int = 0
    assessed: int = 0
    excluded: int = 0

    def as_dict(self) -> dict[str, int]:
        return asdict(self)


@dataclass
class OpenFindingsSummary:
    critical: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0

    def as_dict(self) -> dict[str, int]:
        return asdict(self)

    @property
    def total(self) -> int:
        return self.critical + self.high + self.medium + self.low


@dataclass
class CollectionMeta:
    """Pagination / multi-request completeness for one collector pass."""

    collection_status: CollectionStatus = "complete"
    pages_fetched: int = 0
    items_fetched: int = 0
    retry_count: int = 0
    limited_by: str | None = None
    started_at: str | None = None
    completed_at: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "collection_status": self.collection_status,
            "pages_fetched": self.pages_fetched,
            "items_fetched": self.items_fetched,
            "retry_count": self.retry_count,
            "limited_by": self.limited_by,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
        }


@dataclass
class EvidenceEnvelope:
    """Normalized provider result before grading (spec §4)."""

    capability: CapabilityId
    provider: str
    scope_type: str
    scope_id: str
    asset_type: str
    status: CoverageState
    enabled: bool
    last_observed_at: str | None = None
    last_successful_scan_at: str | None = None
    coverage: CoverageCounts = field(default_factory=CoverageCounts)
    open_findings: OpenFindingsSummary = field(default_factory=OpenFindingsSummary)
    oldest_open_finding_at: str | None = None
    source_reference: str | None = None
    limitations: list[str] = field(default_factory=list)
    collection: CollectionMeta = field(default_factory=CollectionMeta)
    validated: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {
            "capability": self.capability,
            "provider": self.provider,
            "scope_type": self.scope_type,
            "scope_id": self.scope_id,
            "asset_type": self.asset_type,
            "status": self.status,
            "enabled": self.enabled,
            "last_observed_at": self.last_observed_at,
            "last_successful_scan_at": self.last_successful_scan_at,
            "coverage": self.coverage.as_dict(),
            "open_findings": self.open_findings.as_dict(),
            "oldest_open_finding_at": self.oldest_open_finding_at,
            "source_reference": self.source_reference,
            "limitations": list(self.limitations),
            "collection": self.collection.as_dict(),
            "validated": self.validated,
        }


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def is_fresh(
    last_successful_scan_at: str | None,
    capability: CapabilityId,
    *,
    now: datetime | None = None,
) -> bool:
    """True when a successful observation falls inside the lane freshness window."""
    ts = parse_iso(last_successful_scan_at)
    if ts is None:
        return False
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    ref = now or datetime.now(timezone.utc)
    if ref.tzinfo is None:
        ref = ref.replace(tzinfo=timezone.utc)
    days = FRESHNESS_POLICY_DAYS.get(capability, 14)
    return ts >= ref - timedelta(days=days)


def apply_limitation_impacts(
    status: CoverageState,
    limitations: list[str] | None,
    *,
    collection_status: CollectionStatus = "complete",
) -> CoverageState:
    """Enforce Phase A honesty: blocking/incomplete collection cannot stay covered.

    - blocking → cannot be ``covered`` (unknown for permission/plan/missing-inventory;
      otherwise partial)
    - degrading → cannot prove complete scope (covered → partial)
    - informational → no change to an otherwise complete lane
    - only ``collection_status=complete`` may remain covered
    """
    if status == "not_applicable":
        return status

    if collection_status != "complete":
        if collection_status in ("permission_denied", "unavailable_by_plan", "failed"):
            if status in ("covered", "partial", "stale"):
                return "unknown"
            return status
        if status == "covered":
            return "partial"

    codes = list(limitations or [])
    if status == "covered" and has_blocking_limitation(codes):
        if _blocking_implies_unknown(codes):
            return "unknown"
        return "partial"

    if status == "covered" and has_degrading_limitation(codes):
        return "partial"
    return status


_UNKNOWN_BLOCKING_PREFIXES: tuple[str, ...] = (
    "permission_denied",
    "unavailable_by_plan",
    "collection_error",
    "inspector_status_not_collected",
    "inspector_resource_coverage_not_collected",
    "inspector_coverage_collection_failed",
    "osconfig_",
    "scc_not_collected",
    "defender_status_not_collected",
    "defender_resource_coverage_not_collected",
    "no_ec2_inventory",
    "no_ecr_inventory",
    "no_lambda_inventory",
    "no_gce_inventory",
    "no_azure_vm_inventory",
    "assessments_",
    "generic_elasticsearch_not_security_solution",
    "base_datadog_without_cloud_siem_signals",
    "not_threat_detection",
)


def _blocking_implies_unknown(codes: list[str]) -> bool:
    for code in blocking_limitations(codes):
        if any(code == p or code.startswith(p) for p in _UNKNOWN_BLOCKING_PREFIXES):
            return True
        if code == "unavailable_by_plan_or_tier":
            return True
    return False


def grade_from_enablement_and_activity(
    *,
    enabled: bool | None,
    has_observable_activity: bool,
    last_successful_scan_at: str | None,
    capability: CapabilityId,
    permission_denied: bool = False,
    unavailable_by_plan: bool = False,
    intentionally_excluded: bool = False,
    eligible: int = 1,
    assessed: int = 0,
    now: datetime | None = None,
    limitations: list[str] | None = None,
    collection_status: CollectionStatus = "complete",
) -> CoverageState:
    """Core honesty rules: enablement alone never yields covered; unknown ≠ pass.

    - permission_denied / cannot establish denominator → unknown
    - intentionally excluded asset → not counted toward eligible (caller sets counts)
    - enabled without observable activity → partial
    - enabled + activity but stale → stale
    - enabled + fresh activity covering expected scope → covered
    - blocking / incomplete collection never stay covered (Phase A)
    """
    if permission_denied:
        base: CoverageState = "unknown"
    elif unavailable_by_plan and not enabled:
        base = "unknown"
    elif intentionally_excluded:
        base = "not_applicable"
    elif enabled is None:
        base = "unknown"
    elif not enabled:
        base = "not_covered"
    elif not has_observable_activity:
        # Spec: Dependabot enabled with no successful/observable security activity
        # must not become fully verified.
        base = "partial"
    elif not is_fresh(last_successful_scan_at, capability, now=now):
        base = "stale"
    elif eligible > 0 and assessed < eligible:
        base = "partial"
    else:
        base = "covered"

    lim = list(limitations or [])
    if permission_denied and "permission_denied" not in lim:
        lim.append("permission_denied")
    if unavailable_by_plan and "unavailable_by_plan" not in lim:
        lim.append("unavailable_by_plan")
    return apply_limitation_impacts(base, lim, collection_status=collection_status)


def merge_lane_states(states: list[CoverageState]) -> CoverageState:
    """Merge per-scope states for one capability lane (union of providers)."""
    if not states:
        return "unknown"
    unique = set(states)
    if unique == {"not_applicable"}:
        return "not_applicable"
    actionable = [s for s in states if s != "not_applicable"]
    if not actionable:
        return "not_applicable"
    # Unvalidated must never promote to covered (load-bearing demotion lives in
    # _summarize_lane; this is a fail-closed safety net for stray unvalidated inputs).
    if any(s == "unvalidated" for s in actionable):
        without = [s for s in actionable if s != "unvalidated"]
        if not without:
            return "unvalidated"
        base = merge_lane_states(without)
        if base == "covered":
            return "unvalidated"
        return base
    if any(s == "unknown" for s in actionable):
        # Unknown never passes; if anything is unknown and nothing is covered, prefer unknown.
        if not any(s == "covered" for s in actionable):
            return "unknown"
        return "partial"
    if all(s == "covered" for s in actionable):
        return "covered"
    if any(s == "stale" for s in actionable) and not any(
        s in ("not_covered", "partial") for s in actionable
    ):
        return "stale"
    if any(s in ("partial", "stale", "covered") for s in actionable) and any(
        s == "not_covered" for s in actionable
    ):
        return "partial"
    if any(s == "partial" for s in actionable):
        return "partial"
    if any(s == "not_covered" for s in actionable):
        return "not_covered"
    return "unknown"


def rollup_control_status(
    lane_states: dict[CapabilityId, CoverageState],
    *,
    required_lanes: tuple[CapabilityId, ...] | list[CapabilityId],
    external_evidence_covers: set[CapabilityId] | None = None,
) -> Literal["verified", "action_needed", "needs_evidence"]:
    """Spec §3 control rollup from lane states.

    Verified only when every applicable required lane is covered (or externally
    evidenced). Needs evidence is reserved for non-automatable proof — never as
    a fallback for an unimplemented technical API.
    """
    external = external_evidence_covers or set()
    applicable: list[CoverageState] = []
    for lane in required_lanes:
        state = lane_states.get(lane, "unknown")
        if state == "not_applicable":
            continue
        if lane in external:
            continue
        applicable.append(state)
    if not applicable:
        return "verified"
    if all(s == "covered" for s in applicable):
        return "verified"
    if any(s in FAILING_ACTION_STATES or s == "unknown" for s in applicable):
        return "action_needed"
    return "action_needed"


def vendor_absence_does_not_fail(
    lane: CapabilityId,
    connected_providers: set[str],
    *,
    lane_state_from_connected: CoverageState,
) -> CoverageState:
    """Optional scanners (Snyk/Wiz/…) must never be required when an equivalent
    connected provider already satisfies the lane.
    """
    qualifying = LANE_PROVIDERS.get(lane, frozenset())
    optional_missing = OPTIONAL_THIRD_PARTY_SCANNERS - connected_providers
    # Presence of missing optional vendors is irrelevant when we already have a state.
    _ = optional_missing
    if lane_state_from_connected in PASSING_STATES:
        return lane_state_from_connected
    # Still not covered — but only because connected qualifying sources failed,
    # not because an optional vendor is absent.
    connected_qualifying = connected_providers & qualifying
    if not connected_qualifying:
        return lane_state_from_connected
    return lane_state_from_connected


def envelope(
    *,
    capability: CapabilityId,
    provider: str,
    scope_type: str,
    scope_id: str,
    asset_type: str,
    enabled: bool | None,
    has_observable_activity: bool,
    last_observed_at: str | None = None,
    last_successful_scan_at: str | None = None,
    eligible: int = 1,
    assessed: int = 0,
    excluded: int = 0,
    open_findings: OpenFindingsSummary | None = None,
    oldest_open_finding_at: str | None = None,
    source_reference: str | None = None,
    limitations: list[str] | None = None,
    permission_denied: bool = False,
    unavailable_by_plan: bool = False,
    intentionally_excluded: bool = False,
    now: datetime | None = None,
    collection: CollectionMeta | None = None,
    collection_status: CollectionStatus | None = None,
    validated: bool = True,
) -> EvidenceEnvelope:
    """Build a graded evidence envelope from raw collector signals."""
    coll = collection or CollectionMeta()
    if collection_status is not None:
        coll = CollectionMeta(
            collection_status=collection_status,
            pages_fetched=coll.pages_fetched,
            items_fetched=coll.items_fetched,
            retry_count=coll.retry_count,
            limited_by=coll.limited_by,
            started_at=coll.started_at,
            completed_at=coll.completed_at,
        )
    lim = list(limitations or [])
    status = grade_from_enablement_and_activity(
        enabled=enabled,
        has_observable_activity=has_observable_activity,
        last_successful_scan_at=last_successful_scan_at or last_observed_at,
        capability=capability,
        permission_denied=permission_denied,
        unavailable_by_plan=unavailable_by_plan,
        intentionally_excluded=intentionally_excluded,
        eligible=eligible,
        assessed=assessed if has_observable_activity and enabled else assessed,
        now=now,
        limitations=lim,
        collection_status=coll.collection_status,
    )
    # When enabled + activity + fresh, mark assessed.
    if status == "covered" and assessed == 0 and eligible > 0:
        assessed = eligible
    if enabled and not has_observable_activity:
        if "enabled_without_observable_activity" not in lim:
            lim.append("enabled_without_observable_activity")
    if unavailable_by_plan and "unavailable_by_plan" not in lim:
        lim.append("unavailable_by_plan")
    if permission_denied and "permission_denied" not in lim:
        lim.append("permission_denied")
    # Re-apply after auto-appended limitation codes (e.g. enablement-without-activity).
    status = apply_limitation_impacts(status, lim, collection_status=coll.collection_status)
    return EvidenceEnvelope(
        capability=capability,
        provider=provider,
        scope_type=scope_type,
        scope_id=scope_id,
        asset_type=asset_type,
        status=status,
        enabled=bool(enabled),
        last_observed_at=last_observed_at,
        last_successful_scan_at=last_successful_scan_at,
        coverage=CoverageCounts(eligible=eligible, assessed=assessed, excluded=excluded),
        open_findings=open_findings or OpenFindingsSummary(),
        oldest_open_finding_at=oldest_open_finding_at,
        source_reference=source_reference,
        limitations=lim,
        collection=coll,
        validated=validated,
    )


def _lane_collection_complete(lane: dict[str, Any]) -> bool:
    """True when every envelope reports complete collection (or none are present)."""
    envelopes = lane.get("envelopes") or []
    if not envelopes:
        # Summaries without envelopes still carry limitations; treat missing meta as
        # complete only when status is not claiming verified coverage via export path.
        return True
    for env in envelopes:
        coll = env.get("collection") if isinstance(env, dict) else None
        status = (coll or {}).get("collection_status", "complete")
        if status != "complete":
            return False
    return True


def _denominator_known(lane: dict[str, Any]) -> bool:
    coverage = lane.get("coverage") or {}
    eligible = coverage.get("eligible")
    if eligible is None:
        return False
    limitations = list(lane.get("limitations") or [])
    if any(
        c
        in (
            "asset_denominator_not_collected",
            "scanner_connected_without_assessed_assets",
            "no_ec2_inventory",
            "no_ecr_inventory",
            "no_lambda_inventory",
            "no_gce_inventory",
            "no_azure_vm_inventory",
        )
        for c in limitations
    ):
        return False
    return True


def audit_verdict_for_lane(lane: dict[str, Any]) -> dict[str, Any]:
    """Derive an export-safe verdict from the same lane summary Controls uses.

    Fail closed to ``insufficient_evidence``. Never emit verified when a blocking
    limitation, unknown denominator, stale timestamp, or incomplete collection exists.
    """
    status = lane.get("status") or "unknown"
    limitations = list(lane.get("limitations") or [])
    coverage = lane.get("coverage") or {}
    eligible = int(coverage.get("eligible") or 0)
    assessed = int(coverage.get("assessed") or 0)
    label = (lane.get("label") or lane.get("capability") or "this capability").lower()
    blocking = blocking_limitations(limitations)
    primary = primary_limitation(limitations)
    scope_statement = (
        "Technical evidence only; human policy and process operation are not assessed."
    )

    def _pack(
        verdict: AuditVerdict,
        reason: str,
        *,
        next_action: str | None = None,
    ) -> dict[str, Any]:
        return {
            "audit_verdict": verdict,
            "verdict_reason": reason,
            "scope_statement": scope_statement,
            "blocking_limitations": blocking,
            "limitations_detail": serialize_limitations(limitations),
            "next_action": next_action
            or (primary.action if primary else None)
            or lane.get("action"),
        }

    if status == "not_applicable":
        return _pack(
            "not_applicable",
            f"No applicable assets were found for {label} in the connected scope.",
        )

    if status == "covered":
        if has_blocking_limitation(limitations):
            return _pack(
                "insufficient_evidence",
                f"Lane is marked covered but blocking limitations remain for {label}.",
                next_action=primary.action if primary else None,
            )
        if not _lane_collection_complete(lane):
            return _pack(
                "insufficient_evidence",
                f"Collection for {label} is incomplete, so coverage cannot be verified.",
            )
        if eligible > 0 and not _denominator_known(lane):
            return _pack(
                "insufficient_evidence",
                f"Eligible-asset denominator for {label} is unknown.",
            )
        if has_degrading_limitation(limitations):
            return _pack(
                "partial_technical_evidence",
                f"Evidence for {label} is present but incomplete scope proof remains.",
            )
        return _pack(
            "verified_technical_evidence",
            f"Fresh complete evidence covers {assessed} of {eligible} eligible assets."
            if eligible > 0
            else f"Fresh complete evidence verifies {label}.",
        )

    if status == "partial":
        return _pack(
            "partial_technical_evidence",
            f"Evidence covers {assessed} of {eligible} in-scope assets for {label}."
            if eligible > 0
            else f"Evidence for {label} is incomplete.",
        )

    if status == "unvalidated":
        return _pack(
            "insufficient_evidence",
            "Evidence is present from an unvalidated Beta provider; "
            "verdict withheld until live validation.",
        )

    if status == "stale":
        return _pack(
            "insufficient_evidence",
            f"The last complete evidence for {label} is outside the freshness window.",
        )

    if status == "not_covered":
        return _pack(
            "insufficient_evidence",
            f"No qualifying source is protecting in-scope assets for {label}.",
        )

    # unknown or anything unexpected — fail closed
    reason = (
        primary.explanation
        if primary
        else f"Veritrail could not determine coverage for {label}."
    )
    return _pack("insufficient_evidence", reason)
