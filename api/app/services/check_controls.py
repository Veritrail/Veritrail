"""Map Veritrail check_id → compliance controls (framework priority: SOC 2 → CIS → ISO)."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.data.control_narratives import narrative_for
from app.services.control_reference_urls import reference_url

_MAPPINGS_PATH = Path(__file__).parent.parent.parent / "data" / "control_mappings.json"

FRAMEWORK_PRIORITY = ("soc2", "cis_aws_l1", "iso27001")

# Open findings may still use pre-consolidation check_ids (90d); mappings use 45d only.
CHECK_CONTROL_ALIASES: dict[str, str] = {
    "iam.access_key.unused_90d": "iam.access_key.unused_45d",
    "iam.user.inactive_90d": "iam.user.credentials_unused_45d",
}


def resolve_check_id_for_controls(check_id: str) -> str:
    return CHECK_CONTROL_ALIASES.get(check_id, check_id)


@lru_cache(maxsize=1)
def _mapping_entries() -> list[dict[str, Any]]:
    return json.loads(_MAPPINGS_PATH.read_text())


def global_control_checks(framework: str, control_id: str) -> list[str]:
    """Global check_ids for a framework control from control_mappings.json."""
    for entry in _mapping_entries():
        if entry.get("framework") == framework and entry.get("control_id") == control_id:
            return list(entry.get("checks") or [])
    return []


def _priority_index(framework: str) -> int:
    try:
        return FRAMEWORK_PRIORITY.index(framework)
    except ValueError:
        return len(FRAMEWORK_PRIORITY)


def _control_row_from_entry(entry: dict[str, Any]) -> dict[str, Any]:
    fw = entry["framework"]
    cid = entry["control_id"]
    url, url_label, ref_note = reference_url(fw, cid)
    return {
        "framework": fw,
        "control_id": cid,
        "title": entry.get("title", ""),
        "description": entry.get("description", ""),
        "guidance": entry.get("guidance"),
        "narrative": narrative_for(fw, cid),
        "reference_url": url,
        "reference_label": url_label,
        "reference_note": ref_note,
    }


def controls_for_check(
    check_id: str,
    *,
    org_id: Any | None = None,
    db: Any | None = None,
) -> list[dict[str, Any]]:
    """All control rows that include this check, sorted by framework priority.

    When org_id and db are provided, org mapping overrides are applied:
    controls where the check was org-added are included; org-removed checks
    are excluded.
    """
    from app.services.org_control_mappings import (
        effective_checks_for_control,
        load_org_mapping_index,
    )

    mapped_id = resolve_check_id_for_controls(check_id)
    mapping_index = load_org_mapping_index(db, org_id) if org_id and db else None
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for entry in _mapping_entries():
        fw = entry["framework"]
        cid = entry["control_id"]
        global_checks = list(entry.get("checks") or [])
        if mapping_index is not None:
            effective = effective_checks_for_control(
                db,
                org_id,
                fw,
                cid,
                global_checks,
                mapping_index=mapping_index,
            )
        else:
            effective = global_checks
        if mapped_id not in effective:
            continue
        key = (fw, cid)
        if key in seen:
            continue
        seen.add(key)
        rows.append(_control_row_from_entry(entry))
    rows.sort(key=lambda r: (_priority_index(r["framework"]), r["control_id"]))
    return rows


def primary_control_for_check(
    check_id: str,
    *,
    org_id: Any | None = None,
    db: Any | None = None,
) -> dict[str, Any] | None:
    rows = controls_for_check(check_id, org_id=org_id, db=db)
    return rows[0] if rows else None


def check_control_bundle(
    check_id: str,
    *,
    org_id: Any | None = None,
    db: Any | None = None,
) -> dict[str, Any]:
    from app.services.composite_controls import composite_defs_for_check

    rows = controls_for_check(check_id, org_id=org_id, db=db)
    primary = rows[0] if rows else None
    composites = composite_defs_for_check(check_id, org_id=org_id, db=db)
    return {
        "check_id": check_id,
        "framework_priority": list(FRAMEWORK_PRIORITY),
        "primary": primary,
        "controls": rows,
        "frameworks": [r["framework"] for r in rows],
        "composites": composites,
        "primary_composite": composites[0] if composites else None,
    }
