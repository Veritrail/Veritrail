"""Fast finding verification: refresh one resource, re-run one check, resolve if passing."""
from __future__ import annotations

import inspect
from typing import Any

import structlog
from sqlalchemy.orm import Session

from app.checks.registry import ALL_CHECKS
from app.models import AwsAccount, Finding
from app.services.fast_recheck.common import resolve_finding, unchanged, unsupported
from app.services.fast_recheck.targeted_refresh import refresh_resource_for_finding

log = structlog.get_logger()

_CHECK_BY_ID = {mod.CHECK_ID: mod for mod in ALL_CHECKS}


def try_fast_finding_recheck(
    db: Session,
    *,
    account: AwsAccount,
    finding: Finding,
    actor: str,
) -> dict[str, Any]:
    try:
        if not refresh_resource_for_finding(db, account, finding):
            return unsupported()

        mod = _CHECK_BY_ID.get(finding.check_id)
        if not mod:
            return unsupported()

        still_failing_fn = getattr(mod, "still_failing_arn", None)
        if inspect.isfunction(still_failing_fn):
            still_failing = still_failing_fn(db, account.id, finding.resource_arn)
        else:
            drafts = mod.run(db, account.id)
            still_failing = any(
                d.check_id == finding.check_id and d.resource_arn == finding.resource_arn for d in drafts
            )
        if not still_failing:
            return resolve_finding(
                db,
                finding,
                actor=actor,
                note="Fast verify: resource passes check in AWS",
            )

        db.commit()
        return unchanged(reason="resource_still_failing")
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.warning(
            "finding.fast_recheck_failed",
            account_id=str(account.id),
            finding_id=str(finding.id),
            check_id=finding.check_id,
            error=str(exc),
        )
        return unchanged(error=str(exc)[:300])
