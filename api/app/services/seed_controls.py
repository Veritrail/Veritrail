"""Load control_mappings.json into controls + check_controls tables (idempotent)."""
from __future__ import annotations

import json
import uuid
from collections import Counter
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.control import Control, CheckControl

_MAPPINGS_PATH = Path(__file__).parent.parent.parent / "data" / "control_mappings.json"


def seed_controls(db: Session, *, commit: bool = True) -> int:
    raw = json.loads(_MAPPINGS_PATH.read_text())

    # Guard: a (framework, control_id) must appear once. Duplicates silently
    # collide on the unique index (last-write-wins), dropping the loser's checks.
    counts = Counter((e["framework"], e["control_id"]) for e in raw)
    dupes = sorted(k for k, n in counts.items() if n > 1)
    if dupes:
        raise ValueError(f"control_mappings.json has duplicate (framework, control_id): {dupes}")

    upserted = 0
    desired_keys: set[tuple[str, str]] = set()

    for entry in raw:
        framework = entry["framework"]
        control_id_str = entry["control_id"]
        desired_keys.add((framework, control_id_str))

        ctrl = db.scalars(
            select(Control).where(
                Control.framework == framework,
                Control.control_id == control_id_str,
            )
        ).first()

        if ctrl is None:
            ctrl = Control(
                id=uuid.uuid4(),
                framework=framework,
                control_id=control_id_str,
                title=entry["title"],
                description=entry.get("description", ""),
                guidance=entry.get("guidance"),
                soc2_scope_category=entry.get("soc2_scope_category"),
                cis_profile_level=entry.get("cis_profile_level"),
                iso_applicability=entry.get("iso_applicability"),
                iso_applicability_rationale=entry.get("iso_applicability_rationale"),
            )
            db.add(ctrl)
            db.flush()
            upserted += 1
        else:
            ctrl.title = entry["title"]
            ctrl.description = entry.get("description", "")
            ctrl.guidance = entry.get("guidance")
            ctrl.soc2_scope_category = entry.get("soc2_scope_category")
            ctrl.cis_profile_level = entry.get("cis_profile_level")
            ctrl.iso_applicability = entry.get("iso_applicability")
            ctrl.iso_applicability_rationale = entry.get("iso_applicability_rationale")

        existing_links = set(
            db.scalars(
                select(CheckControl.check_id).where(CheckControl.control_id == ctrl.id)
            ).all()
        )
        desired = set(entry.get("checks", []))
        for check_id in desired:
            if check_id not in existing_links:
                db.add(CheckControl(id=uuid.uuid4(), check_id=check_id, control_id=ctrl.id))

        stale = existing_links - desired
        if stale:
            db.execute(
                delete(CheckControl).where(
                    CheckControl.control_id == ctrl.id,
                    CheckControl.check_id.in_(stale),
                )
            )

    # Prune controls that no longer exist in the mappings file (e.g. renumbered
    # control_ids). check_controls rows cascade-delete via the FK.
    for ctrl in db.scalars(select(Control)).all():
        if (ctrl.framework, ctrl.control_id) not in desired_keys:
            db.delete(ctrl)

    if commit:
        db.commit()
    else:
        db.flush()
    return upserted


def effective_checks_for_control_row(
    db: Session,
    org_id: uuid.UUID,
    control: Control,
    global_checks: list[str],
    *,
    mapping_index: dict | None = None,
) -> list[str]:
    """Org-aware check list for a seeded Control row (pack export, API)."""
    from app.services.org_control_mappings import effective_checks_for_db_control

    return effective_checks_for_db_control(
        db,
        org_id,
        control.framework,
        control.control_id,
        global_checks,
        mapping_index=mapping_index,
    )
