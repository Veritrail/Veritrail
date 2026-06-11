"""Guardrails: CIS matrix + frontend stay aligned with control_mappings.json."""
from __future__ import annotations

import json
import re
from pathlib import Path

from app.services.check_frameworks import check_framework_map, frameworks_for_check

REPO = Path(__file__).resolve().parents[2]
MATRIX_PATH = REPO / "api/data/cis_v5_level1_matrix.json"
WEB_MAP_PATH = REPO / "web/src/data/checkFrameworkMap.ts"


def _web_framework_map() -> dict[str, set[str]]:
    text = WEB_MAP_PATH.read_text()
    out: dict[str, set[str]] = {}
    for m in re.finditer(r'"([^"]+)":\s*\[([^\]]*)\]', text):
        cid, arr = m.group(1), m.group(2)
        out[cid] = set(re.findall(r'"([^"]+)"', arr))
    return out


def test_cis_matrix_automated_checks_map_to_cis_framework():
    matrix = json.loads(MATRIX_PATH.read_text())
    missing = []
    for ctrl in matrix["controls"]:
        for check_id in ctrl.get("vigil_check_ids") or []:
            if "cis_aws_l1" not in frameworks_for_check(check_id):
                missing.append(f"{ctrl['id']}:{check_id}")
    assert not missing, f"CIS matrix checks missing cis_aws_l1: {missing}"


def test_web_check_framework_map_matches_api():
    api = check_framework_map()
    web = _web_framework_map()
    assert set(api) == set(web), f"key drift api={len(api)} web={len(web)}"
    drift = []
    for cid in api:
        if set(api[cid]) != web.get(cid, set()):
            drift.append((cid, api[cid], sorted(web.get(cid, set()))))
    assert not drift, f"framework drift: {drift[:10]}"


def test_transit_encryption_checks_span_soc_cis_iso():
    for check_id in ("s3.bucket.no_https_policy",):
        fws = set(frameworks_for_check(check_id))
        assert fws >= {"soc2", "cis_aws_l1", "iso27001"}, f"{check_id} -> {sorted(fws)}"


def test_at_rest_encryption_checks_span_soc_cis_iso():
    for check_id in ("s3.bucket.no_default_encryption", "rds.instance.no_encryption"):
        fws = set(frameworks_for_check(check_id))
        assert fws >= {"soc2", "cis_aws_l1", "iso27001"}, f"{check_id} -> {sorted(fws)}"
