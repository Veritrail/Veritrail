"""Ensure core benchmark checks appear in control_mappings.json."""
from __future__ import annotations

from app.checks.optional_checks import OPTIONAL_CHECK_IDS
from app.checks.registry import ALL_CHECKS
from app.services.check_coverage import tier_for_check
from app.services.check_frameworks import frameworks_for_check


def test_core_checks_have_control_mapping():
    missing = []
    for mod in ALL_CHECKS:
        check_id = mod.CHECK_ID
        if check_id in OPTIONAL_CHECK_IDS:
            continue
        if tier_for_check(check_id) != "core":
            continue
        if not frameworks_for_check(check_id):
            missing.append(check_id)
    assert not missing, f"core checks missing from control_mappings.json: {missing[:20]}"
