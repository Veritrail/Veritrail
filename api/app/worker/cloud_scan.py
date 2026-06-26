"""Lightweight collector → check → persist pipeline for GCP and Azure scans."""
from __future__ import annotations

import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

import structlog
from sqlalchemy.orm import Session

from app.checks.persist import persist_scope_findings

log = structlog.get_logger()


@dataclass
class CloudScanResult:
    ok: bool
    opened: int = 0
    resolved: int = 0
    error: str | None = None


def execute_cloud_scan(
    db: Session,
    *,
    org_id,
    scope_column: str,
    scope_id,
    collectors: list[tuple[str, Callable[[Session, object], int]]],
    checks: list[tuple[str, Callable[[Session, object], list]]],
    target: object,
    on_success: Callable[[], None] | None = None,
    on_error: Callable[[str], None] | None = None,
) -> CloudScanResult:
    try:
        for name, fn in collectors:
            try:
                fn(db, target)
                db.commit()
            except Exception:
                db.rollback()
                log.exception("cloud_scan.collector_failed", collector=name)

        drafts: list = []
        check_ids_run: set[str] = set()
        for mod_name, check_fn in checks:
            try:
                rows = check_fn(db, scope_id)
                if rows:
                    drafts.extend(rows)
                    check_ids_run.add(rows[0].check_id)
            except Exception:
                log.exception("cloud_scan.check_failed", check=mod_name)

        opened, resolved = persist_scope_findings(
            db,
            org_id=org_id,
            scope_column=scope_column,
            scope_id=scope_id,
            drafts=drafts,
            check_ids_run=check_ids_run,
        )
        if on_success:
            on_success()
        db.commit()
        return CloudScanResult(ok=True, opened=opened, resolved=resolved)
    except Exception as e:
        db.rollback()
        tb = traceback.format_exc()
        err = f"{type(e).__name__}: {e}\n{tb}"[:1990]
        if on_error:
            on_error(err)
        db.commit()
        return CloudScanResult(ok=False, error=str(e))
