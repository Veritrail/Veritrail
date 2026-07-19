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

CoverageState = Literal[
    "covered",
    "partial",
    "not_covered",
    "stale",
    "not_applicable",
    "unknown",
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
    {"partial", "not_covered", "stale"}
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
) -> CoverageState:
    """Core honesty rules: enablement alone never yields covered; unknown ≠ pass.

    - permission_denied / cannot establish denominator → unknown
    - intentionally excluded asset → not counted toward eligible (caller sets counts)
    - enabled without observable activity → partial
    - enabled + activity but stale → stale
    - enabled + fresh activity covering expected scope → covered
    """
    if permission_denied:
        return "unknown"
    if unavailable_by_plan and not enabled:
        return "unknown"
    if intentionally_excluded:
        return "not_applicable"
    if enabled is None:
        return "unknown"
    if not enabled:
        return "not_covered"
    if not has_observable_activity:
        # Spec: Dependabot enabled with no successful/observable security activity
        # must not become fully verified.
        return "partial"
    if not is_fresh(last_successful_scan_at, capability, now=now):
        return "stale"
    if eligible > 0 and assessed < eligible:
        return "partial"
    return "covered"


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
) -> EvidenceEnvelope:
    """Build a graded evidence envelope from raw collector signals."""
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
    )
    # When enabled + activity + fresh, mark assessed.
    if status == "covered" and assessed == 0 and eligible > 0:
        assessed = eligible
    lim = list(limitations or [])
    if enabled and not has_observable_activity:
        lim.append("enabled_without_observable_activity")
    if unavailable_by_plan:
        lim.append("unavailable_by_plan")
    if permission_denied:
        lim.append("permission_denied")
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
    )
