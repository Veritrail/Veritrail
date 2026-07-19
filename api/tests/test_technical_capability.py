"""Phase 0 — shared capability semantics and honesty rules."""
from datetime import datetime, timedelta, timezone

from app.services.technical_capability import (
    envelope,
    grade_from_enablement_and_activity,
    merge_lane_states,
    rollup_control_status,
    vendor_absence_does_not_fail,
)


def test_enablement_alone_cannot_return_covered():
    state = grade_from_enablement_and_activity(
        enabled=True,
        has_observable_activity=False,
        last_successful_scan_at=None,
        capability="dependency_scanning",
    )
    assert state == "partial"
    assert state != "covered"

    env = envelope(
        capability="dependency_scanning",
        provider="github_dependabot",
        scope_type="repository",
        scope_id="acme/api",
        asset_type="source_repository",
        enabled=True,
        has_observable_activity=False,
    )
    assert env.status == "partial"
    assert "enabled_without_observable_activity" in env.limitations


def test_enabled_with_fresh_activity_is_covered():
    now = datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc)
    scan_at = (now - timedelta(days=1)).isoformat()
    state = grade_from_enablement_and_activity(
        enabled=True,
        has_observable_activity=True,
        last_successful_scan_at=scan_at,
        capability="dependency_scanning",
        eligible=1,
        assessed=1,
        now=now,
    )
    assert state == "covered"


def test_stale_activity_returns_stale():
    now = datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc)
    scan_at = (now - timedelta(days=30)).isoformat()
    state = grade_from_enablement_and_activity(
        enabled=True,
        has_observable_activity=True,
        last_successful_scan_at=scan_at,
        capability="dependency_scanning",
        eligible=1,
        assessed=1,
        now=now,
    )
    assert state == "stale"


def test_permission_denied_is_unknown_never_passing():
    state = grade_from_enablement_and_activity(
        enabled=None,
        has_observable_activity=False,
        last_successful_scan_at=None,
        capability="secret_scanning",
        permission_denied=True,
    )
    assert state == "unknown"
    rollup = rollup_control_status(
        {"secret_scanning": "unknown"},
        required_lanes=("secret_scanning",),
    )
    assert rollup == "action_needed"


def test_vendor_absence_does_not_fail_when_dependabot_covers():
    """Customer with Dependabot must not fail because Snyk is disconnected."""
    state = vendor_absence_does_not_fail(
        "dependency_scanning",
        connected_providers={"github_dependabot"},
        lane_state_from_connected="covered",
    )
    assert state == "covered"
    # Explicitly: missing Snyk/Wiz does not flip covered → not_covered
    assert state != "not_covered"


def test_missing_optional_vendor_irrelevant_when_native_partial():
    state = vendor_absence_does_not_fail(
        "dependency_scanning",
        connected_providers={"github_dependabot"},
        lane_state_from_connected="partial",
    )
    assert state == "partial"


def test_merge_lane_partial_when_some_repos_uncovered():
    assert merge_lane_states(["covered", "not_covered", "covered"]) == "partial"
    assert merge_lane_states(["covered", "covered"]) == "covered"
    assert merge_lane_states(["not_applicable", "not_applicable"]) == "not_applicable"
    assert merge_lane_states(["unknown", "not_covered"]) == "unknown"


def test_rollup_verified_only_when_all_applicable_covered():
    assert (
        rollup_control_status(
            {
                "dependency_scanning": "covered",
                "source_code_scanning": "covered",
                "host_workload_scanning": "not_applicable",
            },
            required_lanes=(
                "dependency_scanning",
                "source_code_scanning",
                "host_workload_scanning",
            ),
        )
        == "verified"
    )
    assert (
        rollup_control_status(
            {
                "dependency_scanning": "covered",
                "host_workload_scanning": "not_covered",
            },
            required_lanes=("dependency_scanning", "host_workload_scanning"),
        )
        == "action_needed"
    )


def test_dependabot_does_not_imply_host_coverage():
    """Umbrella vulnerability claim is forbidden — SCA covered ≠ host covered."""
    rollup = rollup_control_status(
        {
            "dependency_scanning": "covered",
            "host_workload_scanning": "not_covered",
            "container_image_scanning": "not_covered",
        },
        required_lanes=(
            "dependency_scanning",
            "host_workload_scanning",
            "container_image_scanning",
        ),
    )
    assert rollup == "action_needed"
