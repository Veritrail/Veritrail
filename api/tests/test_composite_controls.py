"""Tests for composite control roll-ups."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

from app.services.composite_controls import composite_control_definitions
from app.services.control_status import compute_control_status


def test_composite_definitions_load():
    defs = composite_control_definitions()
    assert len(defs) >= 2
    ids = {d["id"] for d in defs}
    assert "secure_sdlc" in ids
    assert "identity_governance" in ids
    for entry in defs:
        assert entry.get("checks"), f"{entry['id']} must map checks"


def test_composite_checks_exist_in_registry():
    from app.checks.registry import ALL_CHECKS

    registered = {mod.CHECK_ID for mod in ALL_CHECKS}
    missing = []
    for entry in composite_control_definitions():
        for cid in entry.get("checks", []):
            if cid not in registered:
                missing.append((entry["id"], cid))
    assert not missing, f"composite checks not in registry: {missing}"


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
