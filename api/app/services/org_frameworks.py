"""Per-org custom compliance frameworks (Phase 9)."""
from __future__ import annotations

import re
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.phase9 import OrgFramework

_SLUG_RE = re.compile(r"^[a-z][a-z0-9_-]{1,38}$")


def validate_slug(slug: str) -> str:
    s = (slug or "").strip().lower()
    if not _SLUG_RE.match(s):
        raise ValueError("slug must be 2-39 chars, lowercase alphanumeric with _ or -")
    if s in ("soc2", "cis_aws_l1", "iso27001", "gdpr"):
        # gdpr kept reserved so custom slugs cannot collide with retired framework rows
        raise ValueError("slug conflicts with built-in framework")
    return s


def list_org_frameworks(db: Session, org_id: uuid.UUID) -> list[OrgFramework]:
    return list(
        db.scalars(
            select(OrgFramework).where(OrgFramework.org_id == org_id).order_by(OrgFramework.label)
        ).all()
    )


def get_org_framework(db: Session, org_id: uuid.UUID, slug: str) -> OrgFramework | None:
    return db.scalar(
        select(OrgFramework).where(OrgFramework.org_id == org_id, OrgFramework.slug == slug)
    )


def upsert_org_framework(
    db: Session,
    org_id: uuid.UUID,
    *,
    slug: str,
    label: str,
    description: str | None,
    control_definitions: list[dict[str, Any]],
) -> OrgFramework:
    slug = validate_slug(slug)
    label = (label or "").strip()[:120]
    if not label:
        raise ValueError("label is required")
    cleaned: list[dict[str, Any]] = []
    for item in control_definitions:
        cid = str(item.get("control_id") or "").strip()[:40]
        if not cid:
            continue
        checks = [str(c).strip() for c in (item.get("check_ids") or []) if str(c).strip()]
        cleaned.append(
            {
                "control_id": cid,
                "title": str(item.get("title") or cid)[:200],
                "description": str(item.get("description") or "")[:2000],
                "check_ids": sorted(set(checks)),
            }
        )
    row = get_org_framework(db, org_id, slug)
    if not row:
        row = OrgFramework(id=uuid.uuid4(), org_id=org_id, slug=slug, label=label)
        db.add(row)
    row.label = label
    row.description = (description or "").strip()[:4000] or None
    row.control_definitions = cleaned
    db.flush()
    return row


def delete_org_framework(db: Session, org_id: uuid.UUID, slug: str) -> bool:
    row = get_org_framework(db, org_id, slug)
    if not row:
        return False
    db.delete(row)
    db.flush()
    return True


def framework_catalog_for_org(db: Session, org_id: uuid.UUID) -> list[dict[str, str]]:
    from app.services.check_frameworks import FRAMEWORK_LABELS, framework_catalog

    built_in = framework_catalog()
    custom = [
        {"id": f"org:{row.slug}", "label": row.label, "custom": True}
        for row in list_org_frameworks(db, org_id)
    ]
    return built_in + custom
