"""Workspace provisioning helpers (stable slug generation)."""
from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.org import Org


def slugify(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s[:60] or "workspace"


def unique_org_slug(db: Session, name: str) -> str:
    """A URL-safe slug for the workspace, deduped against existing slugs."""
    base = slugify(name)
    slug = base
    n = 2
    while db.scalar(select(Org.id).where(Org.slug == slug)):
        slug = f"{base}-{n}"
        n += 1
    return slug
