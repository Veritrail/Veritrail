"""Tests for composite control roll-ups."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

from app.services.composite_controls import composite_control_definitions
from app.services.control_status import compute_control_status


def test_composite_definitions_load():
    defs = composite_control_definitions()
    assert len(defs) >= 8
    ids = {d["id"] for d in defs}
    assert ids >= {
        "secure_sdlc",
        "identity_governance",
        "change_management",
        "data_protection",
        "container_vulnerability_monitoring",
        "vulnerability_management",
        "logging_monitoring",
        "backup_resilience",
    }
    for entry in defs:
        assert entry.get("checks"), f"{entry['id']} must map checks"
        assert entry.get("control_id", "").startswith("COMPOSITE.")


def test_tier3_composite_check_mappings():
    by_id = {d["id"]: d for d in composite_control_definitions()}

    change = by_id["change_management"]
    assert "github.repo.no_branch_protection" in change["checks"]
    assert "github.repo.no_env_protection" in change["checks"]
    assert "cloudtrail.trail.not_enabled" in change["checks"]
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
