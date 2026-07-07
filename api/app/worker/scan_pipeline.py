"""Scan pipeline: orchestrates collector → check → persist → snapshot phases.

Extracted from tasks.py to remove nested closures and centralize transaction
control. Each phase is atomic: a failure in one collector rolls back only that
collector's uncommitted work; the pipeline continues with the next collector.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

import structlog
from sqlalchemy.orm import Session

from app.models import AwsAccount, ScanRun
from app.models.org import Org
from app.services.check_settings import is_check_enabled
from app.checks.registry import ALL_CHECKS, is_integration_sync_check, is_source_control_check
from app.worker.snapshot_builder import build_snapshots_from_schema
from app.services.snapshot_provenance import attach_provenance
from app.checks.persist import persist_findings
from app.core.db import SessionLocal
from app.core.aws import ensure_veritrail_role_trust
from app.core.config import get_settings

log = structlog.get_logger()

# Collector step count used for progress math. Must stay in sync with the
# number of _step(...) calls in the collection phase.
_COLLECTOR_STEPS = 32
_FINALIZE_STEPS = 2
# UI phase band starts (0–1). Must stay in sync with UI_PHASE_THRESHOLDS in useScanProgress.ts.
_PHASE_THRESHOLDS = (0.0, 0.05, 0.55, 0.70, 0.85, 0.95)


@dataclass
class CollectorResult:
    """Result of a single collector invocation."""
    name: str
    stats: dict
    error: str | None = None


@dataclass
class CheckResult:
    """Result of the check phase."""
    drafts: list
    check_ids_run: set[str]
    check_errors: list[dict]


@dataclass
class ScanResult:
    """Final result of a full scan."""
    ok: bool
    opened: int = 0
    resolved: int = 0
    snapshots: int = 0
    stats: dict = field(default_factory=dict)
    check_errors: list[dict] = field(default_factory=list)
    error: str | None = None
    step: str | None = None


class ScanProgressTracker:
    """Handles step counting, phase mapping, and progress publishing."""

    def __init__(self, run: ScanRun, enabled_checks: list, db: Session):
        self.run = run
        self.db = db
        self._step_counter = 0
        self._total = _COLLECTOR_STEPS + len(enabled_checks) + _FINALIZE_STEPS
        self._commit_every = 4
        self._stats: dict = {}
        self._current_step_name: str | None = None
        self._collector_index: int | None = None
        self._collector_total: int | None = None

    def _ratio(self, step_counter: int) -> float:
        """Weighted 0–1 ratio matching web/src/hooks/useScanProgress.ts."""
        if self._total <= 0 or step_counter <= 0:
            return 0.0
        collectors = _COLLECTOR_STEPS
        finalize = _FINALIZE_STEPS
        check_total = max(0, self._total - collectors - finalize)
        collection_end = 0.55
        checks_end = 0.95

        if step_counter <= collectors:
            return (step_counter / collectors) * collection_end
        if step_counter <= collectors + check_total:
            check_step = step_counter - collectors
            return collection_end + (check_step / max(1, check_total)) * (checks_end - collection_end)
        finalize_step = step_counter - collectors - check_total
        return checks_end + (finalize_step / max(1, finalize)) * (1 - checks_end)

    def _phase(self, step_counter: int) -> int:
        """Map weighted ratio to UI phase (0–5)."""
        if step_counter <= 1:
            return 0
        ratio = self._ratio(step_counter)
        for i in range(len(_PHASE_THRESHOLDS) - 1, -1, -1):
            if ratio >= _PHASE_THRESHOLDS[i]:
                return max(1, i)
        return 0

    def set_step_name(self, name: str | None) -> None:
        self._current_step_name = name

    def clear_collector_progress(self) -> None:
        """Leave collection phase — stop reporting per-collector index in stats."""
        self._collector_index = None
        self._collector_total = None

    def publish_collector_start(self, index: int, total: int, name: str) -> None:
        """Publish before a collector runs so the UI shows live X/Y + collector name."""
        self._current_step_name = name
        self._collector_index = index
        self._collector_total = total
        self._publish()

    def _publish(self) -> None:
        stats: dict[str, Any] = {
            **self._stats,
            "_progress_step": self._step_counter,
            "_progress_total": self._total,
            "_progress_phase": self._phase(self._step_counter),
            "_progress_step_name": self._current_step_name,
        }
        if self._collector_index is not None and self._collector_total is not None:
            stats["_progress_collector_index"] = self._collector_index
            stats["_progress_collector_total"] = self._collector_total
        self.run.stats = stats
        self.db.commit()

    def _should_publish(self) -> bool:
        """Publish every collector step (slow phase); batch check steps to limit DB writes."""
        if self._step_counter <= _COLLECTOR_STEPS:
            return True
        return (
            self._step_counter % self._commit_every == 0
            or self._step_counter >= self._total - 1
        )

    def step(self, name: str, fn: Callable[[], Any]) -> Any:
        """Execute fn, increment counter, publish progress."""
        result = fn()
        self._step_counter += 1
        if isinstance(result, dict):
            self._stats[name] = result
        if self._should_publish():
            self._publish()
        return result

    def bump(self, count: int = 1) -> None:
        """Bump counter without executing a function (used during check loop)."""
        self._step_counter += count
        if self._should_publish():
            self._publish()

    def finalize(self) -> None:
        """Force a final progress publish."""
        self._publish()

    def set_enabled_checks(self, checks: list) -> None:
        """Store enabled checks so _phase can compute correctly."""
        self._run_checks = checks
        self._total = _COLLECTOR_STEPS + len(checks) + _FINALIZE_STEPS


class ScanPipeline:
    """Orchestrates a full scan for one AWS account."""

    def __init__(self, db: Session, account: AwsAccount, run: ScanRun):
        self.db = db
        self.account = account
        self.run = run
        self.step_name = "bootstrap"
        self.result = ScanResult(ok=False)

    def _bootstrap(self) -> None:
        """Verify dev role trust if needed."""
        settings = get_settings()
        if settings.APP_ENV == "dev" and self.account.role_arn and self.account.external_id:
            ensure_veritrail_role_trust(self.account.role_arn, self.account.external_id)

    def _collect(
        self,
        collectors: list[tuple[str, Callable]],
        tracker: "ScanProgressTracker | None" = None,
    ) -> list[CollectorResult]:
        """Run collectors sequentially. Each collector is atomic (commit on success, rollback on failure).

        Advances the progress tracker once per collector so the bar moves during
        the collection phase (the slow part), instead of freezing on "Initializing".
        """
        results: list[CollectorResult] = []
        collector_total = len(collectors)
        for index, (name, fn) in enumerate(collectors, start=1):
            self.step_name = name
            if tracker is not None:
                tracker.publish_collector_start(index, collector_total, name)
            try:
                stats = fn(self.db, self.account)
                self.db.commit()
                results.append(CollectorResult(name=name, stats=stats or {}))
            except Exception as e:
                self.db.rollback()
                log.exception("scan.collector_failed", collector=name, account_id=str(self.account.id))
                results.append(CollectorResult(name=name, stats={}, error=f"{type(e).__name__}: {e}"))
            if tracker is not None:
                tracker.bump(1)
        return results

    def _run_checks(
        self, enabled_checks: list, tracker: "ScanProgressTracker | None" = None
    ) -> CheckResult:
        """Run all enabled checks. One failing check does not abort the rest.

        Advances the progress tracker once per check so the bar keeps moving
        through the evaluation phase.
        """
        drafts = []
        check_ids_run: set[str] = set()
        check_errors: list[dict] = []

        for mod in enabled_checks:
            self.step_name = f"check:{mod.CHECK_ID}"
            if tracker is not None:
                tracker.set_step_name(self.step_name)
            check_ids_run.add(mod.CHECK_ID)
            try:
                drafts.extend(mod.run(self.db, self.account.id))
            except Exception as inner:
                log.exception(
                    "scan.check_failed",
                    check_id=mod.CHECK_ID,
                    account_id=str(self.account.id),
                )
                check_errors.append({
                    "check_id": mod.CHECK_ID,
                    "error_type": type(inner).__name__,
                    "error": str(inner)[:300],
                })
            if tracker is not None:
                tracker.bump(1)
        return CheckResult(drafts=drafts, check_ids_run=check_ids_run, check_errors=check_errors)

    def _persist(self, check_result: CheckResult) -> dict:
        """Persist findings. Returns {opened, resolved}."""
        self.step_name = "persist_findings"
        opened, resolved = persist_findings(
            self.db,
            org_id=self.account.org_id,
            account_id=self.account.id,
            drafts=check_result.drafts,
            check_ids_run=check_result.check_ids_run,
        )
        self.db.commit()
        return {"opened": opened, "resolved": resolved}

    def _write_snapshots(self) -> int:
        """Write evidence snapshots. Returns count."""
        self.step_name = "write_evidence_snapshots"
        snaps = build_snapshots_from_schema(self.db, self.account, self.run)

        # Special-case: account summary from live AWS API (not DB row)
        if self.account.role_arn and self.account.external_id:
            from app.core.aws import assume_role
            try:
                sess = assume_role(
                    self.account.role_arn,
                    self.account.external_id,
                    session_name="veritrail-account-summary",
                    aws_account=self.account,
                    purpose="evidence_snapshot_account_summary",
                )
                summary_map = sess.client("iam").get_account_summary()["SummaryMap"]
                from app.models import EvidenceSnapshot
                snaps.append(
                    EvidenceSnapshot(
                        id=uuid.uuid4(),
                        scan_run_id=self.run.id,
                        account_id=self.account.id,
                        org_id=self.account.org_id,
                        entity_type="account_summary",
                        entity_id=f"arn:aws:iam::{self.account.account_id}:root",
                        payload_json={
                            "account_id": self.account.account_id,
                            "account_mfa_enabled": bool(summary_map.get("AccountMFAEnabled")),
                            "account_access_keys_present": int(summary_map.get("AccountAccessKeysPresent", 0)),
                            "summary_map": {k: int(v) for k, v in summary_map.items()},
                        },
                    )
                )
            except Exception:
                log.warning("snapshot.account_summary_failed", account_id=str(self.account.id))

        # Special-case: Identity Center permission sets
        from app.collectors.identity_center import list_permission_set_snapshots
        try:
            for ps in list_permission_set_snapshots(self.account):
                arn = ps.get("permission_set_arn")
                if not arn:
                    continue
                from app.models import EvidenceSnapshot
                snaps.append(
                    EvidenceSnapshot(
                        id=uuid.uuid4(),
                        scan_run_id=self.run.id,
                        account_id=self.account.id,
                        org_id=self.account.org_id,
                        entity_type="identity_center_permission_set",
                        entity_id=arn,
                        payload_json=ps,
                    )
                )
        except Exception:
            log.warning("snapshot.identity_center_permission_sets_failed", account_id=str(self.account.id))

        # Attach provenance to every snapshot payload
        for snap in snaps:
            snap.payload_json = attach_provenance(snap.payload_json, snap.entity_type, self.run.id)

        self.db.add_all(snaps)
        self.db.commit()
        return len(snaps)

    def execute(self, collectors: list[tuple[str, Callable]]) -> ScanResult:
        """Run the full pipeline."""
        org_obj = self.db.get(Org, self.account.org_id)
        org_settings = org_obj.settings if org_obj else {}
        enabled_checks = [
            mod
            for mod in ALL_CHECKS
            if is_check_enabled(org_settings, mod.CHECK_ID)
            and not mod.CHECK_ID.startswith(("gcp.", "azure."))
            # Source-control checks run on git sync (org-scoped), not the cloud
            # scan — keeps SDLC out of the per-account scope entirely.
            and not is_source_control_check(mod.CHECK_ID)
            # Identity integration checks run on provider sync (org-scoped).
            and not is_integration_sync_check(mod.CHECK_ID)
        ]

        tracker = ScanProgressTracker(self.run, enabled_checks, self.db)
        tracker.set_enabled_checks(enabled_checks)

        self._bootstrap()
        tracker.set_step_name("bootstrap")
        tracker.step("bootstrap", lambda: {})
        tracker.finalize()  # publish immediately so the UI leaves "Initializing" right away

        # Collect phase — advance per collector through the slow collection work
        collector_results = self._collect(collectors, tracker)
        for cr in collector_results:
            if cr.error:
                tracker._stats.setdefault("collector_errors", []).append({
                    "collector": cr.name,
                    "error": cr.error,
                })

        # Check phase — advance per check
        tracker.clear_collector_progress()
        check_result = self._run_checks(enabled_checks, tracker)

        # Persist findings
        tracker.set_step_name("persist_findings")
        persist_stats = tracker.step("persist_findings", lambda: self._persist(check_result))
        opened = persist_stats["opened"]
        resolved = persist_stats["resolved"]

        # Snapshots
        tracker.set_step_name("write_evidence_snapshots")
        snap_count = tracker.step("write_evidence_snapshots", lambda: self._write_snapshots())

        # Finalize run metadata and stats (tracker.finalize is the single writer for run.stats)
        tracker._stats |= {
            "checks_run": list(check_result.check_ids_run),
            "drafts": len(check_result.drafts),
            "snapshots": snap_count,
            "checks_total": len(ALL_CHECKS),
        }
        if check_result.check_errors:
            tracker._stats["check_errors"] = check_result.check_errors
            tracker._stats["checks_failed"] = len(check_result.check_errors)

        self.run.status = "degraded" if check_result.check_errors else "ok"
        self.run.finished_at = datetime.now(timezone.utc)
        self.run.findings_opened = opened
        self.run.findings_resolved = resolved
        self.account.last_scan_at = self.run.finished_at
        tracker.finalize()
        final_stats = self.run.stats
        self.db.commit()

        return ScanResult(
            ok=True,
            opened=opened,
            resolved=resolved,
            snapshots=snap_count,
            stats=final_stats,
            check_errors=check_result.check_errors,
        )
