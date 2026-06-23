"""CIS AWS Foundations coverage matrix (honest subset vs full benchmark)."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_MAPPINGS_PATH = Path(__file__).parent.parent.parent / "data" / "control_mappings.json"
_V5_MATRIX_PATH = Path(__file__).parent.parent.parent / "data" / "cis_v5_level1_matrix.json"

# CIS AWS Foundations Benchmark v5.0 Level 1 — Veritrail matrix row count (see cis_v5_level1_matrix.json).
CIS_V5_LEVEL1_TOTAL = 42


@lru_cache(maxsize=1)
def cis_v5_level1_matrix() -> dict:
    return json.loads(_V5_MATRIX_PATH.read_text())


@lru_cache(maxsize=1)
def cis_benchmark_coverage() -> dict:
    raw = json.loads(_MAPPINGS_PATH.read_text())
    cis_rows = [e for e in raw if e.get("framework") == "cis_aws_l1"]
    by_id: dict[str, dict] = {}
    for e in cis_rows:
        cid = e["control_id"]
        checks = list(e.get("checks") or [])
        if cid in by_id:
            existing = set(by_id[cid]["check_ids"])
            existing.update(checks)
            by_id[cid]["check_ids"] = sorted(existing)
            by_id[cid]["status"] = "automated" if by_id[cid]["check_ids"] else "manual"
        else:
            by_id[cid] = {
                "control_id": cid,
                "title": e.get("title", ""),
                "check_ids": checks,
                "status": "automated" if checks else "manual",
            }
    controls = sorted(by_id.values(), key=lambda x: x["control_id"])
    v5 = cis_v5_level1_matrix()
    v5_controls = v5.get("controls") or []
    automated_v5 = sum(1 for c in v5_controls if c.get("veritrail_status") == "automated")
    partial_v5 = sum(1 for c in v5_controls if c.get("veritrail_status") == "partial")
    extended_v5 = sum(1 for c in v5_controls if c.get("veritrail_status") == "extended")
    manual_v5 = sum(1 for c in v5_controls if c.get("veritrail_status") == "manual")

    return {
        "framework": "cis_aws_l1",
        "reference_benchmark": "CIS Amazon Web Services Foundations Benchmark",
        "reference_versions": ["v3.0.0 (selected controls)", "v5.0.0 (40 Level 1 controls — not fully automated)"],
        "veritrail_claim": "curated_subset",
        "cis_v5_level1_total": CIS_V5_LEVEL1_TOTAL,
        "mapped_control_count": len(controls),
        "mapped_control_count_with_checks": sum(1 for c in controls if c["check_ids"]),
        "coverage_ratio": round(len(controls) / CIS_V5_LEVEL1_TOTAL, 3) if CIS_V5_LEVEL1_TOTAL else 0,
        "cis_v5_matrix": {
            "version": v5.get("version"),
            "control_count": len(v5_controls),
            "automated": automated_v5,
            "partial": partial_v5,
            "extended": extended_v5,
            "manual": manual_v5,
            "controls": v5_controls,
        },
        "disclaimer": (
            "Veritrail automates a subset of CIS AWS Foundations controls mapped in control_mappings.json. "
            "This is not full CIS v5.0 Level 1 parity. Unmapped CIS controls require manual attestation."
        ),
        "controls": controls,
    }
