"""Phase 5 — optional scanner envelopes and provider IDs."""
from __future__ import annotations

from app.services.scanner_capability_evidence import (
    SCANNER_LANE_MAP,
    build_scanner_capability_evidence,
    envelopes_from_scanner_config,
    vendor_key,
)
from app.services.technical_capability import vendor_absence_does_not_fail


def test_vendor_key_strips_scanner_prefix():
    assert vendor_key("scanner_tenable") == "tenable"
    assert vendor_key("snyk") == "snyk"


def test_snyk_maps_to_sca_and_sast_lanes():
    rows = build_scanner_capability_evidence(
        "snyk",
        open_findings_count=3,
        last_synced_at="2026-07-19T00:00:00+00:00",
        severity_counts={"high": 2, "medium": 1},
    )
    caps = {r["capability"] for r in rows}
    assert "dependency_scanning" in caps
    assert "source_code_scanning" in caps
    assert all(r["provider"] == "snyk" for r in rows)
    assert all(r["status"] == "partial" for r in rows)
    assert all("asset_denominator_not_collected" in r["limitations"] for r in rows)


def test_scanner_can_cover_when_authoritative_asset_denominator_is_known():
    rows = build_scanner_capability_evidence(
        "snyk",
        open_findings_count=0,
        asset_count=12,
        last_synced_at="2026-07-19T00:00:00+00:00",
    )
    assert all(r["status"] == "covered" for r in rows)
    assert all(r["coverage"]["eligible"] == 12 for r in rows)


def test_tenable_host_lane_without_findings_is_partial():
    rows = build_scanner_capability_evidence(
        "scanner_tenable",
        open_findings_count=0,
        last_synced_at="2026-07-19T00:00:00+00:00",
    )
    host = next(r for r in rows if r["capability"] == "host_workload_scanning")
    assert host["status"] == "partial"
    assert "scanner_connected_without_assessed_assets" in host["limitations"]


def test_snyk_absence_does_not_fail_when_native_covers():
    state = vendor_absence_does_not_fail(
        "dependency_scanning",
        {"github_dependabot"},
        lane_state_from_connected="covered",
    )
    assert state == "covered"


def test_envelopes_from_legacy_config():
    envs = envelopes_from_scanner_config(
        "scanner_wiz",
        {"open_findings_count": 4, "last_synced_at": "2026-07-19T00:00:00+00:00"},
    )
    assert any(e.capability == "cloud_findings_posture" for e in envs)
    assert SCANNER_LANE_MAP["wiz"]
