"""SOC 2 / framework questionnaire export (Phase 9)."""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.data.control_narratives import narrative_detail_for, narrative_for
from app.models.control import Control, CheckControl
from app.services.org_frameworks import get_org_framework
from app.services.seed_controls import effective_checks_for_control_row
from app.services.org_control_mappings import load_org_mapping_index


def build_questionnaire(
    db: Session,
    org_id: uuid.UUID,
    framework: str,
    *,
    account_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Full questionnaire: every control with narrative + effective checks."""
    if framework.startswith("org:"):
        slug = framework[4:]
        custom = get_org_framework(db, org_id, slug)
        if not custom:
            raise ValueError("custom framework not found")
        items = []
        for defn in custom.control_definitions or []:
            cid = defn.get("control_id")
            check_ids = defn.get("check_ids") or []
            detail = narrative_detail_for("soc2", cid, check_ids) if cid else {}
            items.append(
                {
                    "control_id": cid,
                    "title": defn.get("title"),
                    "description": defn.get("description"),
                    "check_ids": check_ids,
                    "short_answer": detail.get("short_answer"),
                    "long_answer": detail.get("long_answer") or narrative_for("soc2", cid or ""),
                    "evidence_refs": detail.get("evidence_refs") or [],
                }
            )
        return {
            "framework": framework,
            "framework_label": custom.label,
            "custom": True,
            "control_count": len(items),
            "controls": items,
        }

    mapping_index = load_org_mapping_index(db, org_id)
    controls = db.scalars(
        select(Control).where(Control.framework == framework).order_by(Control.control_id)
    ).all()
    items: list[dict[str, Any]] = []
    for ctrl in controls:
        links = db.scalars(
            select(CheckControl.check_id).where(CheckControl.control_id == ctrl.id)
        ).all()
        check_ids = effective_checks_for_control_row(
            db, org_id, ctrl, list(links), mapping_index=mapping_index
        )
        detail = narrative_detail_for(ctrl.framework, ctrl.control_id, check_ids)
        items.append(
            {
                "control_id": ctrl.control_id,
                "title": ctrl.title,
                "description": ctrl.description,
                "guidance": ctrl.guidance,
                "check_ids": check_ids,
                "short_answer": detail.get("short_answer"),
                "long_answer": detail.get("long_answer") or narrative_for(ctrl.framework, ctrl.control_id),
                "evidence_refs": detail.get("evidence_refs") or [],
            }
        )
    from app.services.check_frameworks import FRAMEWORK_LABELS

    return {
        "framework": framework,
        "framework_label": FRAMEWORK_LABELS.get(framework, framework),
        "custom": False,
        "control_count": len(items),
        "controls": items,
    }
