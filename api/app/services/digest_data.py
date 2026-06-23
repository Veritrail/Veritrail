"""Shared gathering of the rich-digest extras (per-day trend, coverage, deltas).

Used by both the weekly worker task and the manual "send test digest" endpoint so
the test email is identical to the real one.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AwsAccount, ScanRun
from app.models.digest_snapshot import DigestSnapshot


def gather_digest_extras(
    db: Session, *, org_id: uuid.UUID, account_id: uuid.UUID, since: datetime
) -> tuple[list[dict], dict, dict | None]:
    """Return (per_day, coverage, prev) for the rich digest.

    per_day: 7 dicts {label, new, resolved} oldest->newest (from ScanRun deltas).
    coverage: {accounts_done, accounts_total, regions}.
    prev: last week's DigestSnapshot as a dict, or None on the first run.
    """
    runs = db.scalars(
        select(ScanRun).where(ScanRun.account_id == account_id, ScanRun.started_at >= since)
    ).all()
    by_new: dict = {}
    by_res: dict = {}
    latest = None
    for r in runs:
        d = r.started_at.date()
        by_new[d] = by_new.get(d, 0) + (r.findings_opened or 0)
        by_res[d] = by_res.get(d, 0) + (r.findings_resolved or 0)
        if latest is None or r.started_at > latest.started_at:
            latest = r

    today = datetime.now(timezone.utc).date()
    per_day = [
        {
            "label": (today - timedelta(days=i)).strftime("%b %-d"),
            "new": by_new.get(today - timedelta(days=i), 0),
            "resolved": by_res.get(today - timedelta(days=i), 0),
        }
        for i in range(6, -1, -1)
    ]

    accounts_total = db.scalar(
        select(func.count()).select_from(select(AwsAccount).where(AwsAccount.org_id == org_id).subquery())
    ) or 0
    accounts_done = db.scalar(
        select(func.count()).select_from(
            select(AwsAccount).where(AwsAccount.org_id == org_id, AwsAccount.status == "connected").subquery()
        )
    ) or 0
    regions = 0
    if latest and isinstance(latest.stats, dict):
        regions = max(
            [v for k, v in latest.stats.items() if k.endswith("_regions") and isinstance(v, (int, float))],
            default=0,
        )
    coverage = {
        "accounts_done": accounts_done,
        "accounts_total": accounts_total or accounts_done,
        "regions": f"{int(regions)} / {int(regions)}" if regions else "—",
    }

    prev_row = db.scalars(
        select(DigestSnapshot)
        .where(
            DigestSnapshot.org_id == org_id,
            DigestSnapshot.captured_at < datetime.now(timezone.utc) - timedelta(days=3),
        )
        .order_by(DigestSnapshot.captured_at.desc())
    ).first()
    prev = (
        {
            "open_count": prev_row.open_count,
            "new_count": prev_row.new_count,
            "resolved_count": prev_row.resolved_count,
            "posture_score": prev_row.posture_score,
        }
        if prev_row
        else None
    )
    return per_day, coverage, prev
