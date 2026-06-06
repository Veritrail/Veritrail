"""Assert core checks have framework mapping and frontend label coverage."""
from __future__ import annotations

import re
from pathlib import Path

from app.checks.optional_checks import OPTIONAL_CHECK_IDS
from app.checks.registry import ALL_CHECKS
from app.services.check_coverage import tier_for_check
from app.services.check_frameworks import frameworks_for_check

REPO_ROOT = Path(__file__).resolve().parents[2]
CHECK_LABELS_PATH = REPO_ROOT / "web" / "src" / "data" / "checkLabels.ts"
CHECK_FRAMEWORK_MAP_PATH = REPO_ROOT / "web" / "src" / "data" / "checkFrameworkMap.ts"
# Docker api service mounts web at /web
if not CHECK_LABELS_PATH.exists():
    CHECK_LABELS_PATH = Path("/web/src/data/checkLabels.ts")
    CHECK_FRAMEWORK_MAP_PATH = Path("/web/src/data/checkFrameworkMap.ts")


def _parse_ts_string_map(path: Path) -> set[str]:
    text = path.read_text()
    return set(re.findall(r'"([^"]+)":\s*\[', text)) | set(re.findall(r'"([^"]+)":\s*"', text))


def _core_check_ids() -> list[str]:
    out = []
    for mod in ALL_CHECKS:
        check_id = mod.CHECK_ID
        if check_id in OPTIONAL_CHECK_IDS:
            continue
        if tier_for_check(check_id) != "core":
            continue
        out.append(check_id)
    return sorted(out)


def test_core_checks_have_frontend_labels():
    labels = _parse_ts_string_map(CHECK_LABELS_PATH)
    missing = [cid for cid in _core_check_ids() if cid not in labels]
    assert not missing, f"core checks missing from checkLabels.ts: {missing[:20]}"


def test_core_checks_in_check_framework_map_when_used():
    mapped_keys = _parse_ts_string_map(CHECK_FRAMEWORK_MAP_PATH)
    missing = []
    for check_id in _core_check_ids():
        if not frameworks_for_check(check_id):
            continue
        if check_id not in mapped_keys:
            missing.append(check_id)
    assert not missing, f"mapped core checks missing from checkFrameworkMap.ts: {missing[:20]}"
