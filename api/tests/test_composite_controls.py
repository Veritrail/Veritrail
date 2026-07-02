"""Tests for composite control roll-ups."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

from app.services.composite_controls import (
    assert_control_mapping_composite_coverage,
    composite_control_definitions,
    control_mapping_checks_missing_from_composites,
    soc2_control_checks,
)
from app.services.control_status import compute_control_status


def test_composite_definitions_load():
    defs = composite_control_definitions()
    assert len(defs) >= 8
    ids = {d["id"] for d in defs}
    assert ids >= {
        "secure_sdlc",
        "identity_governance",
        "asset_inventory",
        "change_management",
        "data_protection",
        "container_vulnerability_monitoring",
        "vulnerability_management",
        "logging_monitoring",
        "backup_resilience",
    }
    for entry in defs:
        if entry["id"] == "endpoint_security":
            continue  # AWS cannot observe corporate endpoints — external evidence only
        assert entry.get("checks"), f"{entry['id']} must map checks"
        assert entry.get("control_id", "").startswith("COMPOSITE.")


def test_tier3_composite_check_mappings():
    by_id = {d["id"]: d for d in composite_control_definitions()}

    change = by_id["change_management"]
    assert "github.repo.no_branch_protection" in change["checks"]
    assert "github.repo.no_env_protection" in change["checks"]
    assert "cloudtrail.event.rds_instance_created_or_modified" in change["checks"]
    assert "github.repo.dependabot_disabled" not in change["checks"]

    container = by_id["container_vulnerability_monitoring"]
    assert "aws.vulnerability_monitoring.not_detected" in container["checks"]
    assert "aws.inspector.active_critical_finding" in container["checks"]
    assert "ecr.registry.enhanced_scanning_disabled" in container["checks"]

    logging = by_id["logging_monitoring"]
    assert "guardduty.detector.not_enabled" in logging["checks"]
    assert "aws.config.not_enabled" in logging["checks"]
    assert "cloudtrail.trail.not_enabled" in logging["checks"]

    backup = by_id["backup_resilience"]
    assert "rds.snapshot.public" in backup["checks"]
    assert "ec2.ebs.snapshot_public" in backup["checks"]
    assert "dynamodb.table.no_pitr" in backup["checks"]


def test_composite_checks_exist_in_registry():
    from app.checks.registry import ALL_CHECKS

    registered = {mod.CHECK_ID for mod in ALL_CHECKS}
    missing = []
    for entry in composite_control_definitions():
        for cid in entry.get("checks", []):
            if cid not in registered:
                missing.append((entry["id"], cid))
    assert not missing, f"composite checks not in registry: {missing}"


def test_secure_sdlc_excludes_env_protection():
    by_id = {d["id"]: d for d in composite_control_definitions()}
    sdlc = by_id["secure_sdlc"]["checks"]
    assert "github.repo.no_env_protection" not in sdlc
    assert "gitlab.repo.no_env_protection" not in sdlc


def test_every_control_mapping_check_in_composite():
    missing = control_mapping_checks_missing_from_composites()
    assert not missing, f"control_mappings checks missing composite: {missing}"


def test_control_mapping_composite_coverage_assertion():
    assert_control_mapping_composite_coverage()


def test_cc61_aligned_with_asset_inventory_composite():
    by_id = {d["id"]: d for d in composite_control_definitions()}
    asset_checks = set(by_id["asset_inventory"]["checks"])
    cc61_checks = set(soc2_control_checks("CC6.1"))
    assert cc61_checks, "CC6.1 must map checks"
    assert cc61_checks == asset_checks, (
        f"CC6.1 and asset_inventory composite must match: "
        f"only_cc61={sorted(cc61_checks - asset_checks)} only_asset={sorted(asset_checks - cc61_checks)}"
    )


def test_cc61_is_inventory_focused():
    cc61_checks = soc2_control_checks("CC6.1")
    forbidden_prefixes = ("cloudtrail.", "s3.", "kms.", "rds.", "ec2.", "github.repo.", "gitlab.repo.")
    bad = [cid for cid in cc61_checks if cid.startswith(forbidden_prefixes)]
    assert not bad, f"CC6.1 must not include non-inventory checks: {bad}"


def test_every_registered_check_mapped_to_composite():
    from app.checks.registry import ALL_CHECKS

    registered = {mod.CHECK_ID for mod in ALL_CHECKS}
    mapped: set[str] = set()
    for entry in composite_control_definitions():
        mapped.update(entry.get("checks", []))
    missing = sorted(registered - mapped)
    assert not missing, f"checks missing composite mapping: {missing}"


def test_compute_control_status_pass_when_scanned_clean():
    f = MagicMock()
    f.check_id = "iam.user.no_mfa"
    f.status = "open"
    status, hits, count = compute_control_status(
        ["iam.user.no_mfa"],
        {},
        {"iam.user.no_mfa"},
        set(),
        has_scanned_account=True,
    )
    assert status == "pass"
    assert hits == []
    assert count == 0


def test_compute_control_status_fail_on_open_finding():
    f = MagicMock()
    f.check_id = "iam.user.no_mfa"
    f.status = "open"
    f.severity = "high"
    status, hits, count = compute_control_status(
        ["iam.user.no_mfa"],
        {"iam.user.no_mfa": [f]},
        {"iam.user.no_mfa"},
        set(),
        has_scanned_account=True,
    )
    assert status == "fail"
    assert count == 1
    assert len(hits) == 1


def test_composite_json_valid():
    path = Path(__file__).resolve().parents[1] / "data" / "composite_controls.json"
    data = json.loads(path.read_text())
    assert isinstance(data, list)


def test_hygiene_findings_do_not_fail_controls():
    """Only benchmark-class findings carry pass/fail weight — hygiene checks
    (optional cleanup signal) must never flip a control to failing."""
    f = MagicMock()
    f.check_id = "iam.policy.unattached"  # optional -> hygiene class
    f.status = "open"
    status, hits, count = compute_control_status(
        ["iam.policy.unattached"],
        {"iam.policy.unattached": [f]},
        {"iam.policy.unattached"},
        set(),
        has_scanned_account=True,
    )
    assert status == "pass"
    assert hits == []
    assert count == 0


def test_supporting_findings_do_not_fail_controls():
    """Supporting findings never FAIL a control — but a control whose checks
    are all supporting-class must not report a vacuous pass while those
    signals are red (e.g. Incident Response with GuardDuty off). It degrades
    to at_risk and surfaces the findings."""
    f = MagicMock()
    f.check_id = "iam.policy.wildcard_resource"  # supporting-only class
    f.status = "open"
    status, hits, count = compute_control_status(
        ["iam.policy.wildcard_resource"],
        {"iam.policy.wildcard_resource": [f]},
        {"iam.policy.wildcard_resource"},
        set(),
        has_scanned_account=True,
    )
    assert status == "at_risk"
    assert hits == [f]
    assert count == 1


def test_supporting_findings_do_not_downgrade_benchmark_controls():
    """When a control has at least one benchmark-class check, open supporting
    findings alone leave a clean pass untouched."""
    f = MagicMock()
    f.check_id = "iam.policy.wildcard_resource"  # supporting-only class
    f.status = "open"
    status, hits, count = compute_control_status(
        ["iam.policy.wildcard_resource", "iam.root.no_mfa"],
        {"iam.policy.wildcard_resource": [f]},
        {"iam.policy.wildcard_resource", "iam.root.no_mfa"},
        set(),
        has_scanned_account=True,
    )
    assert status == "pass"
    assert hits == []
    assert count == 0
