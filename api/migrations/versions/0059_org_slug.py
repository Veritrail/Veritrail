"""Stable per-workspace slug on orgs."""
import re

import sqlalchemy as sa
from alembic import op

revision = "0059"
down_revision = "0058"
branch_labels = None
depends_on = None


def _slugify(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s[:60] or "workspace"


def upgrade() -> None:
    op.add_column("orgs", sa.Column("slug", sa.String(length=120), nullable=True))

    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, name FROM orgs ORDER BY created_at")).fetchall()
    used: set[str] = set()
    for rid, name in rows:
        base = _slugify(name)
        slug = base
        n = 2
        while slug in used:
            slug = f"{base}-{n}"
            n += 1
        used.add(slug)
        conn.execute(sa.text("UPDATE orgs SET slug = :s WHERE id = :i"), {"s": slug, "i": rid})

    op.create_index("ix_orgs_slug", "orgs", ["slug"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_orgs_slug", table_name="orgs")
    op.drop_column("orgs", "slug")
