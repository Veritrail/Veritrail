"""Collect IAM service last-accessed details per role via AWS async job API.

Strategy: submit all jobs in parallel, then collect whatever is ready.
AWS caches last-accessed data so most jobs complete in <2s.
"""
from __future__ import annotations

import time
import uuid

import structlog
from botocore.exceptions import ClientError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.aws import assume_role
from app.models import AwsAccount, IamPermUsage, IamRole

log = structlog.get_logger()

_COLLECT_WAIT = 8    # seconds to wait after submitting all jobs before collecting
_POLL_MAX = 12       # collect-phase retries per job
_ROLE_LIMIT = 100    # process up to 100 non-service roles per scan


def collect_perm_usage(db: Session, account: AwsAccount) -> int:
    sess = assume_role(account.role_arn, account.external_id, session_name="vigil-perm-usage", aws_account=account, purpose="collect_perm_usage")
    iam = sess.client("iam")

    roles = db.scalars(select(IamRole).where(IamRole.account_id == account.id)).all()
    roles = [r for r in roles if "/aws-service-role/" not in r.arn][:_ROLE_LIMIT]

    # submit all jobs first — ACTION_LEVEL is a superset of SERVICE_LEVEL
    jobs: list[tuple[str, str]] = []  # (role_arn, job_id)
    for role in roles:
        try:
            job_id = iam.generate_service_last_accessed_details(
                Arn=role.arn,
                Granularity="ACTION_LEVEL",
            )["JobId"]
            jobs.append((role.arn, job_id))
        except ClientError as e:
            log.warning("perm_usage.submit_skip", arn=role.arn, error=str(e))

    if not jobs:
        return 0

    # wait once for AWS to process the batch
    time.sleep(_COLLECT_WAIT)

    # collect results — retry briefly per job if still IN_PROGRESS
    upserted = 0
    for role_arn, job_id in jobs:
        try:
            upserted += _collect_job(db, iam, account.id, role_arn, job_id)
        except ClientError as e:
            log.warning("perm_usage.collect_skip", arn=role_arn, error=str(e))


    log.info("perm_usage.done", roles=len(jobs), upserted=upserted)
    return upserted


def _collect_job(db: Session, iam, account_id, role_arn: str, job_id: str) -> int:
    for attempt in range(_POLL_MAX):
        resp = iam.get_service_last_accessed_details(JobId=job_id)
        status = resp["JobStatus"]
        if status == "COMPLETED":
            return _persist_completed_job(db, iam, account_id, role_arn, job_id, resp)
        if status == "FAILED":
            return 0
        # still IN_PROGRESS — wait 1s and retry
        time.sleep(1)
    return 0


def _persist_completed_job(
    db: Session,
    iam,
    account_id,
    role_arn: str,
    job_id: str,
    first_page: dict,
) -> int:
    """Persist all service/action rows, following IsTruncated pagination."""
    count = 0
    page = first_page
    while True:
        for svc in page.get("ServicesLastAccessed", []):
            _upsert(db, account_id, role_arn, svc)
            count += 1
        if not page.get("IsTruncated"):
            break
        page = iam.get_service_last_accessed_details(JobId=job_id, Marker=page["Marker"])
    return count


def _append_tracked_action(
    actions: list[dict],
    *,
    service_ns: str,
    name: str | None,
    last_accessed,
) -> None:
    if not name or last_accessed is None:
        return
    if ":" not in name and service_ns:
        name = f"{service_ns}:{name}"
    if hasattr(last_accessed, "isoformat"):
        last_accessed = last_accessed.isoformat()
    key = name.lower()
    for existing in actions:
        if existing.get("action", "").lower() == key:
            return
    actions.append({"action": name, "last_authenticated": last_accessed})


def _tracked_actions_from_svc(svc: dict) -> list | None:
    """Extract used actions from IAM action-level last-accessed payloads."""
    service_ns = (svc.get("ServiceNamespace") or "").lower()
    actions: list[dict] = []

    for entry in svc.get("TrackedActionsLastAccessed") or []:
        _append_tracked_action(
            actions,
            service_ns=service_ns,
            name=entry.get("ActionName"),
            last_accessed=entry.get("LastAccessedTime"),
        )

    # Some API responses still surface ActionLastAccessed (LastAuthenticated) instead of TrackedActions*.
    for entry in svc.get("ActionLastAccessed") or []:
        _append_tracked_action(
            actions,
            service_ns=service_ns,
            name=entry.get("ActionName"),
            last_accessed=entry.get("LastAuthenticated"),
        )

    return actions or None


def _upsert(db: Session, account_id, principal_arn: str, svc: dict) -> None:
    actions = _tracked_actions_from_svc(svc)

    stmt = pg_insert(IamPermUsage).values(
        id=uuid.uuid4(),
        account_id=account_id,
        principal_arn=principal_arn,
        service=svc["ServiceNamespace"],
        last_authenticated=svc.get("LastAuthenticated"),
        actions_json=actions,
    )
    update_cols: dict = {"last_authenticated": stmt.excluded.last_authenticated}
    if actions is not None:
        update_cols["actions_json"] = stmt.excluded.actions_json
    stmt = stmt.on_conflict_do_update(
        index_elements=["account_id", "principal_arn", "service"],
        set_=update_cols,
    )
    db.execute(stmt)
