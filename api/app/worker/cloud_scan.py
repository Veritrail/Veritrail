"""Lightweight collector → check → persist pipeline for GCP and Azure scans."""
from __future__ import annotations

import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

import structlog
from sqlalchemy.orm import Session

from app.checks.persist import persist_scope_findings
from app.models.cloud_scan_run import CloudScanRun

log = structlog.get_logger()


@dataclass
class CloudScanResult:
    ok: bool
    opened: int = 0
    resolved: int = 0
    error: str | None = None


class CloudScanProgressTracker:
    """Publishes step/phase progress into CloudScanRun.stats for the Accounts UI."""

    def __init__(
        self,
        run: CloudScanRun,
        db: Session,
        *,
        collector_count: int,
        check_count: int,
    ):
        self.run = run
        self.db = db
        self._collector_count = collector_count
        self._check_count = check_count
        self._total = collector_count + check_count + 1
        self._step_counter = 0
        self._current_step_name: str | None = "bootstrap"
        self._collector_index: int | None = None
        self._collector_total: int | None = None

    def _phase(self) -> int:
        if self._step_counter <= 1:
            return 0
        if self._step_counter <= self._collector_count + 1:
            return 1
        if self._step_counter <= self._collector_count + self._check_count + 1:
            mid = self._collector_count + max(1, self._check_count // 2) + 1
            return 2 if self._step_counter <= mid else 3
        return 5

    def _publish(self) -> None:
        stats: dict[str, Any] = {
            **(self.run.stats or {}),
            "_progress_step": self._step_counter,
            "_progress_total": self._total,
            "_progress_phase": self._phase(),
            "_progress_step_name": self._current_step_name,
        }
        if self._collector_index is not None and self._collector_total is not None:
            stats["_progress_collector_index"] = self._collector_index
            stats["_progress_collector_total"] = self._collector_total
        else:
            stats.pop("_progress_collector_index", None)
            stats.pop("_progress_collector_total", None)
        self.run.stats = stats
        self.db.commit()

    def start(self) -> None:
        self._step_counter = 1
        self._current_step_name = "bootstrap"
        self._publish()

    def publish_collector_start(self, index: int, total: int, name: str) -> None:
        self._current_step_name = name
        self._collector_index = index
        self._collector_total = total
        self._publish()

    def collector_done(self) -> None:
        self._step_counter += 1
        self._publish()

    def publish_check_start(self, name: str) -> None:
        self._collector_index = None
        self._collector_total = None
        self._current_step_name = f"check:{name}"
        self._publish()

    def check_done(self) -> None:
        self._step_counter += 1
        self._publish()

    def finalize(self) -> None:
        self._collector_index = None
        self._collector_total = None
        self._current_step_name = "persist_findings"
        self._step_counter = self._total
        self._publish()


def execute_cloud_scan(
    db: Session,
    *,
    org_id,
    scope_column: str,
    scope_id,
    collectors: list[tuple[str, Callable[[Session, object], int]]],
    checks: list[tuple[str, Callable[[Session, object], list]]],
    target: object,
    scan_run: CloudScanRun | None = None,
    on_success: Callable[[], None] | None = None,
    on_error: Callable[[str], None] | None = None,
) -> CloudScanResult:
    tracker = (
        CloudScanProgressTracker(
            scan_run,
            db,
            collector_count=len(collectors),
            check_count=len(checks),
        )
        if scan_run
        else None
    )
    try:
        if tracker:
            tracker.start()

        collector_total = len(collectors)
        for index, (name, fn) in enumerate(collectors, start=1):
            if tracker:
                tracker.publish_collector_start(index, collector_total, name)
            try:
                fn(db, target)
                db.commit()
            except Exception:
                db.rollback()
                log.exception("cloud_scan.collector_failed", collector=name)
            finally:
                if tracker:
                    tracker.collector_done()

        drafts: list = []
        check_ids_run: set[str] = set()
        check_errors: list[str] = []
        for mod_name, check_fn in checks:
            if tracker:
                tracker.publish_check_start(mod_name)
            try:
                rows = check_fn(db, scope_id)
                if rows:
                    drafts.extend(rows)
                    check_ids_run.add(rows[0].check_id)
            except Exception:
                check_errors.append(mod_name)
                log.exception("cloud_scan.check_failed", check=mod_name)
            finally:
                if tracker:
                    tracker.check_done()

        if tracker:
            tracker.finalize()
            stats = dict(scan_run.stats or {})
            stats["checks_run_count"] = len(checks)
            stats["check_error_count"] = len(check_errors)
            scan_run.stats = stats

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
        if scan_run:
            stats = dict(scan_run.stats or {})
            stats["error_type"] = type(e).__name__
            stats["failed_at"] = tracker._current_step_name if tracker else "unknown"
            scan_run.stats = stats
        if on_error:
            on_error(err)
        db.commit()
        return CloudScanResult(ok=False, error=str(e))
