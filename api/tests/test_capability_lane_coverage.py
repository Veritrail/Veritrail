"""Phase 0/1 — capability lane grading from repo evidence."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

from app.services.capability_lane_coverage import (
    _github_repo_envelopes,
    _summarize_lane,
    build_capability_lane_coverage,
)
from app.services.technical_capability import OpenFindingsSummary, envelope, merge_lane_states


def _repo(
    *,
    name: str = "acme/api",
    features: dict | None = None,
) -> MagicMock:
    repo = MagicMock()
    repo.id = uuid.uuid4()
    repo.name = name
    repo.default_branch = "main"
    repo.security_features = features or {}
    return repo


def test_enablement_only_github_repo_is_partial_not_covered():
    now = datetime(2026, 7, 19, tzinfo=timezone.utc)
    repo = _repo(
        features={
            "dependabot_alerts": True,
            "code_scanning": True,
            "secret_scanning": True,
            # No capability_evidence → legacy enablement-only snapshot
        }
    )
    envelopes = _github_repo_envelopes(repo, None, now=now)
    dep = next(e for e in envelopes if e.capability == "dependency_scanning")
    assert dep.enabled is True
    assert dep.status == "partial"
    assert "enablement_only_legacy_snapshot" in dep.limitations


def test_dependabot_with_observable_activity_covers_lane():
    now = datetime(2026, 7, 19, tzinfo=timezone.utc)
    repo = _repo(
        features={
            "dependabot_alerts": True,
            "capability_evidence": {
                "dependency_scanning": {
                    "enabled": True,
                    "permission_status": "ok",
                    "last_successful_scan_at": now.isoformat(),
                    "has_observable_activity": True,
                    "open_findings": {"critical": 0, "high": 1, "medium": 0, "low": 0},
                    "limitations": [],
                }
            },
            "actions_evidence": {
                "has_workflows": True,
                "has_observable_activity": True,
                "security_job_success": True,
                "last_successful_run_at": now.isoformat(),
                "permission_status": "ok",
            },
        }
    )
    envelopes = _github_repo_envelopes(repo, None, now=now)
    dep = next(e for e in envelopes if e.capability == "dependency_scanning")
    assert dep.status == "covered"


def test_snyk_absence_does_not_fail_when_dependabot_covers():
    """Acceptance: Dependabot can verify dependency scanning without Snyk."""
    now = datetime(2026, 7, 19, tzinfo=timezone.utc)
    repo = _repo(
        features={
            "dependabot_alerts": True,
            "capability_evidence": {
                "dependency_scanning": {
                    "enabled": True,
                    "permission_status": "ok",
                    "last_successful_scan_at": now.isoformat(),
                    "has_observable_activity": True,
                    "open_findings": {"critical": 0, "high": 0, "medium": 0, "low": 0},
                    "limitations": [],
                }
            },
        }
    )
    envelopes = _github_repo_envelopes(repo, None, now=now)
    dep_states = [e.status for e in envelopes if e.capability == "dependency_scanning"]
    assert merge_lane_states(dep_states) == "covered"


def test_equivalent_providers_do_not_double_count_same_scope():
    now = datetime(2026, 7, 19, tzinfo=timezone.utc)
    native = envelope(
        capability="host_workload_scanning",
        provider="amazon_inspector_ec2",
        scope_type="aws_account",
        scope_id="111122223333",
        asset_type="ec2_instance",
        enabled=True,
        has_observable_activity=True,
        last_successful_scan_at=now.isoformat(),
        eligible=10,
        assessed=10,
        open_findings=OpenFindingsSummary(high=2),
        now=now,
    )
    scanner = envelope(
        capability="host_workload_scanning",
        provider="tenable",
        scope_type="aws_account",
        scope_id="111122223333",
        asset_type="ec2_instance",
        enabled=True,
        has_observable_activity=True,
        last_successful_scan_at=now.isoformat(),
        eligible=10,
        assessed=10,
        open_findings=OpenFindingsSummary(high=2),
        now=now,
    )
    lane = _summarize_lane(
        "host_workload_scanning",
        [native, scanner],
        {"amazon_inspector_ec2", "tenable"},
    )
    assert lane["status"] == "covered"
    assert lane["coverage"] == {"eligible": 10, "assessed": 10, "excluded": 0}
    assert lane["open_findings"]["high"] == 2


def test_build_capability_lane_coverage_empty_org_unknown_lanes(mock_db):
    org_id = uuid.uuid4()
    empty = MagicMock()
    empty.all.return_value = []

    def _scalars(_stmt=None):
        return empty

    mock_db.scalars.side_effect = _scalars
    mock_db.scalar.return_value = None
    # Nested savepoint for optional snapshot persistence
    nested = MagicMock()
    nested.__enter__ = MagicMock(return_value=None)
    nested.__exit__ = MagicMock(return_value=False)
    mock_db.begin_nested.return_value = nested

    data = build_capability_lane_coverage(mock_db, org_id, persist_snapshot=False)
    assert data["repos_total"] == 0
    assert data["lanes"]["dependency_scanning"]["status"] == "unknown"
    # Phase 2 stubs removed — cloud lanes grade from collectors (unknown when no data)
    assert data["lanes"]["host_workload_scanning"]["status"] == "unknown"
    assert "phase2_native_cloud_pending" not in (
        data["lanes"]["host_workload_scanning"].get("limitations") or []
    )
    # Missing Snyk must not invent a failure reason
    assert data["lanes"]["dependency_scanning"]["action"] is None or "Snyk" not in (
        data["lanes"]["dependency_scanning"]["action"] or ""
    )
    assert "operational" in data


def _edr_host_envelope(
    *,
    validated: bool,
    provider: str = "crowdstrike",
    scope_id: str = "tenant-default",
    eligible: int = 12,
    assessed: int = 12,
    high: int = 3,
):
    from app.services.technical_capability import CoverageCounts, EvidenceEnvelope

    now = datetime(2026, 7, 20, tzinfo=timezone.utc)
    limitations = [] if validated else ["edr_unvalidated_beta"]
    return EvidenceEnvelope(
        capability="host_workload_scanning",
        provider=provider,
        scope_type="tenant",
        scope_id=scope_id,
        asset_type="managed_device",
        status="covered",
        enabled=True,
        last_successful_scan_at=now.isoformat(),
        coverage=CoverageCounts(eligible=eligible, assessed=assessed, excluded=0),
        open_findings=OpenFindingsSummary(high=high),
        limitations=limitations,
        validated=validated,
    )


def test_edr_beta_alone_is_unvalidated_not_verified():
    from app.services.technical_capability import rollup_control_status

    env = _edr_host_envelope(validated=False)
    lane = _summarize_lane("host_workload_scanning", [env], {"crowdstrike"})
    assert lane["status"] == "unvalidated"
    assert lane["audit_verdict"] == "insufficient_evidence"
    assert lane["audit_verdict"] != "verified_technical_evidence"
    assert lane["coverage"]["eligible"] == 12
    assert lane["coverage"]["assessed"] == 12
    assert lane["open_findings"]["high"] == 3
    assert "edr_unvalidated_beta" in lane["limitations"]
    assert (
        rollup_control_status(
            {"host_workload_scanning": lane["status"]},
            required_lanes=("host_workload_scanning",),
        )
        == "action_needed"
    )


def test_edr_ga_validated_can_verify():
    env = _edr_host_envelope(validated=True)
    lane = _summarize_lane("host_workload_scanning", [env], {"crowdstrike"})
    assert lane["status"] == "covered"
    assert lane["audit_verdict"] == "verified_technical_evidence"


def test_edr_beta_not_load_bearing_keeps_covered():
    now = datetime(2026, 7, 20, tzinfo=timezone.utc)
    from app.services.technical_capability import CoverageCounts, EvidenceEnvelope

    inspector = envelope(
        capability="host_workload_scanning",
        provider="amazon_inspector_ec2",
        scope_type="aws_account",
        scope_id="111122223333",
        asset_type="ec2_instance",
        enabled=True,
        has_observable_activity=True,
        last_successful_scan_at=now.isoformat(),
        eligible=10,
        assessed=10,
        open_findings=OpenFindingsSummary(high=1),
        now=now,
    )
    # Same scope as Inspector so Beta is clearly not independently load-bearing.
    beta = EvidenceEnvelope(
        capability="host_workload_scanning",
        provider="crowdstrike",
        scope_type="aws_account",
        scope_id="111122223333",
        asset_type="managed_device",
        status="covered",
        enabled=True,
        last_successful_scan_at=now.isoformat(),
        coverage=CoverageCounts(eligible=10, assessed=10, excluded=0),
        open_findings=OpenFindingsSummary(high=3),
        limitations=["edr_unvalidated_beta"],
        validated=False,
    )
    lane = _summarize_lane(
        "host_workload_scanning",
        [inspector, beta],
        {"amazon_inspector_ec2", "crowdstrike"},
    )
    assert lane["status"] == "covered"
    assert lane["audit_verdict"] == "verified_technical_evidence"
