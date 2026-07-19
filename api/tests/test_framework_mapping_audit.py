"""Guardrails: CIS matrix + frontend stay aligned with control_mappings.json."""
from __future__ import annotations

import json
import re
from pathlib import Path

from app.data.control_narratives import NARRATIVES, SHORT_ANSWERS
from app.services.check_frameworks import check_framework_map, frameworks_for_check

_API_ROOT = Path(__file__).resolve().parents[1]
MATRIX_PATH = _API_ROOT / "data" / "cis_v5_level1_matrix.json"

REPO_ROOT = Path(__file__).resolve().parents[2]
WEB_MAP_PATH = REPO_ROOT / "web/src/data/checkFrameworkMap.ts"
# Docker api service: app at /app, web mounted at /web
if not WEB_MAP_PATH.exists():
    WEB_MAP_PATH = Path("/web/src/data/checkFrameworkMap.ts")

CHECK_COPY_PATHS = [
    REPO_ROOT / "web/src/data/checkComplianceCopy.ts",
    REPO_ROOT / "web/src/data/checkDocumentation.ts",
    REPO_ROOT / "web/src/components/FindingDrawer.tsx",
]
if not CHECK_COPY_PATHS[0].exists():
    CHECK_COPY_PATHS = [
        Path("/web/src/data/checkComplianceCopy.ts"),
        Path("/web/src/data/checkDocumentation.ts"),
        Path("/web/src/components/FindingDrawer.tsx"),
    ]

# Check-level: no single-check narrative may claim full CC satisfaction
CHECK_CC_OVERCLAIM = re.compile(
    r"\b(satisf(y|ies|ying)|fulfil(l)?s|required by|violating)\b"
    r"[^.\n]{0,60}\b(SOC\s*2?\s*)?CC\d",
    re.I,
)

# Control-level CC short answers: no entity-level pass/fail opener
CC_SHORT_OVERCLAIM = re.compile(
    r"^(Logical access|Credentials are|Least-privilege|External access paths|"
    r"Encryption at rest|Malware and threat|Security monitoring is active)",
    re.I,
)

# CC long narratives: first sentence must not be bare entity attestation
CC_LONG_ENTITY_OPENER = re.compile(
    r"^(Logical access|System credentials|Access to protected|Logical access controls|"
    r"Transmission and storage|Controls protect|Configuration changes|Security events|"
    r"Changes to infrastructure|The entity|Board and management)",
    re.I,
)


def _web_framework_map() -> dict[str, set[str]]:
    text = WEB_MAP_PATH.read_text()
    out: dict[str, set[str]] = {}
    for m in re.finditer(r'"([^"]+)":\s*\[([^\]]*)\]', text):
        cid, arr = m.group(1), m.group(2)
        out[cid] = set(re.findall(r'"([^"]+)"', arr))
    return out


def _quoted_strings(path: Path) -> list[str]:
    return re.findall(r'"([^"\\]*(?:\\.[^"\\]*)*)"', path.read_text())


def test_cis_matrix_automated_checks_map_to_cis_framework():
    matrix = json.loads(MATRIX_PATH.read_text())
    missing = []
    for ctrl in matrix["controls"]:
        for check_id in ctrl.get("veritrail_check_ids") or []:
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


def test_check_narratives_do_not_claim_full_cc_satisfaction():
    violations = []
    for path in CHECK_COPY_PATHS:
        if not path.exists():
            continue
        for s in _quoted_strings(path):
            if CHECK_CC_OVERCLAIM.search(s):
                violations.append(f"{path.name}: {s[:140]}")
    assert not violations, "Check copy overclaims CC control satisfaction:\n" + "\n".join(
        violations
    )


def test_cc_short_answers_use_supports_not_satisfies():
    bad = {
        k: v
        for k, v in SHORT_ANSWERS.items()
        if k.startswith("CC") and CC_SHORT_OVERCLAIM.match(v)
    }
    assert not bad, f"CC SHORT_ANSWERS overclaim: {bad}"


def test_cc_long_narratives_lead_with_supports_not_entity_attestation():
    bad = {}
    for k, v in NARRATIVES.items():
        if not k.startswith("CC"):
            continue
        first = v.split(". ")[0]
        if CC_LONG_ENTITY_OPENER.match(first):
            bad[k] = first
        if "supports" not in first.lower() and "support" not in first.lower():
            bad[k] = first
    assert not bad, f"CC NARRATIVES must lead with supports-phrasing: {bad}"
