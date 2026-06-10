"""Batch fast recheck: refresh N resources, run each check once, persist once."""
from __future__ import annotations

from typing import Any

import structlog
from sqlalchemy.orm import Session

from app.checks.persist import persist_findings
from app.checks.registry import ALL_CHECKS
from app.models import AwsAccount, Finding
from app.services.fast_recheck.targeted_refresh import refresh_resource_for_finding

log = structlog.get_logger()

_CHECK_BY_ID = {mod.CHECK_ID: mod for mod in ALL_CHECKS}
_MAX_BATCH = 50


def try_fast_findings_recheck_batch(
    db: Session,
    *,
    account: AwsAccount,
    findings: list[Finding],
    actor: str,
) -> dict[str, Any] | None:
    """Fast batch verify. Returns None when caller should queue Celery recheck_finding."""
    if not findings:
        return {"queued": False, "checked": True, "check_id": None, "results": []}
    if len(findings) > _MAX_BATCH:
        return None

    check_id = findings[0].check_id
    if any(f.check_id != check_id or f.account_id != account.id for f in findings):
        return None

    mod = _CHECK_BY_ID.get(check_id)
    if not mod:
        return None

    before_status = {f.id: f.status for f in findings}

    try:
        for finding in findings:
            if not refresh_resource_for_finding(db, account, finding):
                db.rollback()
                return None

        drafts = mod.run(db, account.id)
        persist_findings(
            db,
            org_id=account.org_id,
            account_id=account.id,
            drafts=drafts,
            check_ids_run={check_id},
        )
        db.commit()

        results: list[dict[str, Any]] = []
        for finding in findings:
            db.refresh(finding)
            was_open = before_status.get(finding.id) == "open"
            now_resolved = finding.status == "resolved"
            results.append(
                {
                    "finding_id": str(finding.id),
                    "checked": True,
                    "resolved": bool(was_open and now_resolved),
                },
            )

        return {
            "queued": False,
            "checked": True,
            "check_id": check_id,
            "results": results,
        }
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.warning(
            "finding.fast_recheck_batch_failed",
            account_id=str(account.id),
            check_id=check_id,
            count=len(findings),
            error=str(exc),
        )
        return None
