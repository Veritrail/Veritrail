"""Per-org control → check_id mapping overrides (Phase 7).

Merge rule: effective = (global ∪ added) − removed.
Falls back to global control_mappings.json / check_controls when no row exists.
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.org_control_mapping import FRAMEWORKS, OrgControlMapping

ControlKey = tuple[str, str]  # (framework, control_id)


def _as_check_list(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    return [str(c).strip() for c in raw if str(c).strip()]


def merge_effective_checks(
    global_checks: list[str],
    *,
    added: list[str] | None = None,
    removed: list[str] | None = None,
) -> list[str]:
    """(global ∪ added) − removed, stable sorted."""
    base = set(global_checks)
    if added:
        base |= set(added)
    if removed:
        base -= set(removed)
    return sorted(base)


def global_control_checks(framework: str, control_id: str) -> list[str]:
    from app.services.check_controls import global_control_checks as _global

    return _global(framework, control_id)


def load_org_mapping_index(db: Session, org_id: uuid.UUID) -> dict[ControlKey, OrgControlMapping]:
    rows = db.scalars(select(OrgControlMapping).where(OrgControlMapping.org_id == org_id)).all()
    return {(r.framework, r.control_id): r for r in rows}


def org_override_for(
    mapping_index: dict[ControlKey, OrgControlMapping],
    framework: str,
    control_id: str,
) -> OrgControlMapping | None:
    return mapping_index.get((framework, control_id))


def effective_check_ids(
    global_checks: list[str],
    *,
    added: list[str] | None = None,
    removed: list[str] | None = None,
) -> list[str]:
    return merge_effective_checks(global_checks, added=added, removed=removed)


def effective_checks_for_control(
    db: Session | None,
    org_id: uuid.UUID | None,
    framework: str,
    control_id: str,
    global_checks: list[str] | None = None,
    *,
    mapping_index: dict[ControlKey, OrgControlMapping] | None = None,
) -> list[str]:
    base = list(global_checks if global_checks is not None else global_control_checks(framework, control_id))
    if not org_id or db is None:
        return base
    index = mapping_index if mapping_index is not None else load_org_mapping_index(db, org_id)
    row = org_override_for(index, framework, control_id)
    if not row:
        return base
    return effective_check_ids(
        base,
        added=_as_check_list(row.added_check_ids),
        removed=_as_check_list(row.removed_check_ids),
    )


def effective_checks_for_db_control(
    db: Session,
    org_id: uuid.UUID,
    framework: str,
    control_id: str,
    global_checks: list[str],
    *,
    mapping_index: dict[ControlKey, OrgControlMapping] | None = None,
) -> list[str]:
    return effective_checks_for_control(
        db,
        org_id,
        framework,
        control_id,
        global_checks,
        mapping_index=mapping_index,
    )


def effective_composite_check_ids(
    db: Session,
    org_id: uuid.UUID,
    entry: dict[str, Any],
    *,
    mapping_index: dict[ControlKey, OrgControlMapping] | None = None,
) -> list[str]:
    """Composite roll-up checks with per-criterion org overrides applied."""
    index = mapping_index if mapping_index is not None else load_org_mapping_index(db, org_id)
    checks = set(entry.get("checks") or [])
    criteria: list[tuple[str, str]] = [
        ("soc2", "soc2_criteria"),
        ("cis_aws_l1", "cis_criteria"),
        ("iso27001", "iso_criteria"),
    ]
    for framework, key in criteria:
        for control_ref in entry.get(key) or []:
            global_checks = global_control_checks(framework, control_ref)
            effective = effective_checks_for_control(
                db,
                org_id,
                framework,
                control_ref,
                global_checks,
                mapping_index=index,
            )
            global_set = set(global_checks)
            effective_set = set(effective)
            checks |= effective_set - global_set
            checks -= global_set - effective_set
    return sorted(checks)


def validate_check_ids(check_ids: list[str]) -> list[str]:
    from app.checks.registry import ALL_CHECKS

    registered = {mod.CHECK_ID for mod in ALL_CHECKS}
    unknown = sorted({c for c in check_ids if c not in registered})
    if unknown:
        raise ValueError(f"unknown check_id(s): {', '.join(unknown)}")
    return check_ids


def upsert_org_mapping(
    db: Session,
    org_id: uuid.UUID,
    framework: str,
    control_id: str,
    *,
    added_check_ids: list[str],
    removed_check_ids: list[str],
) -> OrgControlMapping | None:
    if framework not in FRAMEWORKS:
        raise ValueError(f"framework must be one of {sorted(FRAMEWORKS)}")
    added = validate_check_ids(_as_check_list(added_check_ids))
    removed = validate_check_ids(_as_check_list(removed_check_ids))
    overlap = set(added) & set(removed)
    if overlap:
        raise ValueError(f"check_id(s) cannot be both added and removed: {sorted(overlap)}")
    if not added and not removed:
        return delete_org_mapping(db, org_id, framework, control_id)

    global_checks = set(global_control_checks(framework, control_id))
    if not global_checks and not added:
        raise ValueError("control not found in global mappings")

    row = db.scalar(
        select(OrgControlMapping).where(
            OrgControlMapping.org_id == org_id,
            OrgControlMapping.framework == framework,
            OrgControlMapping.control_id == control_id,
        )
    )
    if row is None:
        row = OrgControlMapping(
            id=uuid.uuid4(),
            org_id=org_id,
            framework=framework,
            control_id=control_id,
        )
        db.add(row)
    row.added_check_ids = added
    row.removed_check_ids = removed
    db.flush()
    return row


def delete_org_mapping(
    db: Session,
    org_id: uuid.UUID,
    framework: str,
    control_id: str,
) -> None:
    row = db.scalar(
        select(OrgControlMapping).where(
            OrgControlMapping.org_id == org_id,
            OrgControlMapping.framework == framework,
            OrgControlMapping.control_id == control_id,
        )
    )
    if row:
        db.delete(row)
        db.flush()


def mapping_out(
    framework: str,
    control_id: str,
    global_checks: list[str],
    row: OrgControlMapping | None,
) -> dict[str, Any]:
    added = _as_check_list(row.added_check_ids) if row else []
    removed = _as_check_list(row.removed_check_ids) if row else []
    effective = effective_check_ids(global_checks, added=added, removed=removed)
    return {
        "framework": framework,
        "control_id": control_id,
        "global_check_ids": global_checks,
        "added_check_ids": added,
        "removed_check_ids": removed,
        "effective_check_ids": effective,
        "has_override": bool(added or removed),
    }
