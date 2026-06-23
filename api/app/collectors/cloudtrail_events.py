"""Collect significant CloudTrail write events for the infrastructure timeline.

This collector is intentionally lightweight because it runs inside the main scan.
It pulls recent or incremental CloudTrail management events for the History page
without turning every compliance scan into a 90-day log backfill.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import structlog
from botocore.exceptions import ClientError
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.collectors.cloudtrail_shared import _get_regions
from app.collectors.cloudtrail import _discover_trails
from app.core.aws import assume_role
from app.models import AwsAccount
from app.models.cloudtrail import CloudTrailEvent

log = structlog.get_logger()

TRACKED_EVENTS = {
    "CreateUser", "DeleteUser", "AttachUserPolicy", "DetachUserPolicy",
    "CreateRole", "DeleteRole", "AttachRolePolicy", "DetachRolePolicy",
    "CreatePolicy", "DeletePolicy", "PutRolePolicy", "DeleteRolePolicy",
    "PutUserPolicy", "DeleteUserPolicy", "UpdateAssumeRolePolicy",
    "AddUserToGroup", "RemoveUserFromGroup",
    "AuthorizeSecurityGroupIngress", "RevokeSecurityGroupIngress",
    "AuthorizeSecurityGroupEgress", "RevokeSecurityGroupEgress",
    "CreateSecurityGroup", "DeleteSecurityGroup",
    "PutBucketPolicy", "DeleteBucketPolicy", "PutBucketAcl",
    "PutBucketPublicAccessBlock", "CreateBucket", "DeleteBucket",
    "RunInstances", "TerminateInstances", "ModifyInstanceAttribute",
    "CreateKey", "DisableKey", "ScheduleKeyDeletion", "PutKeyPolicy",
    "StopLogging", "DeleteTrail", "UpdateTrail", "CreateTrail",
    "DeleteDetector", "StopConfigurationRecorder",
    "CreateFunction", "UpdateFunctionConfiguration",
    "ModifyDBInstance", "CreateDBInstance",
}

_READ_PREFIXES = (
    "Get", "List", "Describe", "Head", "BatchGet", "Lookup", "Scan",
    "Query", "Select", "Test", "Validate", "Filter", "Check",
)

_SIGNAL_EVENT_SOURCES = (
    "iam.amazonaws.com",
    "s3.amazonaws.com",
    "ec2.amazonaws.com",
    "kms.amazonaws.com",
    "cloudtrail.amazonaws.com",
    "rds.amazonaws.com",
    "lambda.amazonaws.com",
    "elasticloadbalancing.amazonaws.com",
    "secretsmanager.amazonaws.com",
    "ssm.amazonaws.com",
    "dynamodb.amazonaws.com",
    "sns.amazonaws.com",
    "sqs.amazonaws.com",
    "guardduty.amazonaws.com",
    "config.amazonaws.com",
    "securityhub.amazonaws.com",
    "access-analyzer.amazonaws.com",
)

_SKIP_EVENT_NAMES = frozenset({
    "ConsoleLogin",
    "CredentialVerification",
    "Decrypt",
    "GenerateDataKey",
    "UpdateInstanceInformation",
    "UpdateInstanceAssociationStatus",
    "PutComplianceItems",
    "PutInventory",
})

# Keep the main scan quick. The first scan gets enough timeline context for the
# UI, then later scans only look back slightly from the newest event already
# stored. A dedicated history backfill can use a longer window later if needed.
_INITIAL_LOOKBACK_DAYS = 7
_INCREMENTAL_OVERLAP_HOURS = 6
_MAX_LOOKBACK_DAYS = 90
_MAX_EVENTS_PER_RUN = 300
_PAGE_SIZE = 50


def _dedupe_resources(resources: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for r in resources:
        name = r.get("name") or ""
        typ = (r.get("type") or "").lower()
        display = name.split("/")[-1] if name.startswith("arn:") else name
        key = f"{typ}|{display.lower()}"
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def _lookup_regions(sess) -> list[str]:
    trails = _discover_trails(sess)
    if trails:
        return sorted({t.get("HomeRegion") or "us-east-1" for t in trails})
    return _get_regions(sess)


def _ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _scan_start_time(db: Session, account: AwsAccount, now: datetime) -> datetime:
    latest = db.scalar(
        select(func.max(CloudTrailEvent.event_time)).where(CloudTrailEvent.account_id == account.id)
    )
    if latest:
        latest = _ensure_aware(latest)
        start = latest - timedelta(hours=_INCREMENTAL_OVERLAP_HOURS)
        floor = now - timedelta(days=_MAX_LOOKBACK_DAYS)
        if start < floor:
            start = floor
        if start >= now:
            start = now - timedelta(hours=_INCREMENTAL_OVERLAP_HOURS)
        return start
    return now - timedelta(days=_INITIAL_LOOKBACK_DAYS)


def _should_collect(ct_event: dict, event_name: str) -> bool:
    if not event_name or event_name in _SKIP_EVENT_NAMES:
        return False
    if event_name in TRACKED_EVENTS:
        return True
    if ct_event.get("readOnly") is True:
        return False
    if any(event_name.startswith(prefix) for prefix in _READ_PREFIXES):
        return False
    source = (ct_event.get("eventSource") or "").lower()
    if not any(sig in source for sig in _SIGNAL_EVENT_SOURCES):
        return False
    event_type = ct_event.get("eventType") or ""
    if event_type and event_type not in ("AwsApiCall", "AwsServiceEvent"):
        return False
    return True


def _parse_cloudtrail_event(evt: dict) -> tuple[dict, str, str]:
    ct_event = evt.get("CloudTrailEvent") or "{}"
    if isinstance(ct_event, str):
        try:
            ct_event = json.loads(ct_event)
        except Exception:
            ct_event = {}
    event_name = evt.get("EventName", "") or ct_event.get("eventName", "")
    event_source = evt.get("EventSource", "") or ct_event.get("eventSource", "")
    return ct_event, event_name, event_source


def collect_cloudtrail_events(db: Session, account: AwsAccount) -> int:
    sess = assume_role(
        account.role_arn,
        account.external_id,
        session_name="veritrail-ct-events",
        aws_account=account,
        purpose="collect_cloudtrail_events",
    )
    now = datetime.now(timezone.utc)
    start = _scan_start_time(db, account, now)
    regions = _lookup_regions(sess)

    collected = 0
    seen_event_ids: set[str] = set()
    scanned = 0
    skipped_readonly = 0

    for region in regions:
        if collected >= _MAX_EVENTS_PER_RUN:
            break
        try:
            ct = sess.client("cloudtrail", region_name=region)
            paginator = ct.get_paginator("lookup_events")
            # MaxItems is per-paginator; use the *global* remaining, not per-region.
            remaining = _MAX_EVENTS_PER_RUN - collected
            if remaining <= 0:
                break
            pages = paginator.paginate(
                StartTime=start,
                EndTime=now,
                PaginationConfig={"MaxItems": remaining, "PageSize": _PAGE_SIZE},
            )
            for page in pages:
                for evt in page.get("Events", []):
                    scanned += 1
                    ct_event, event_name, event_source = _parse_cloudtrail_event(evt)
                    if not _should_collect(ct_event, event_name):
                        if ct_event.get("readOnly") is True:
                            skipped_readonly += 1
                        continue

                    event_id = evt.get("EventId", "")
                    if not event_id or event_id in seen_event_ids:
                        continue
                    seen_event_ids.add(event_id)

                    actor = (
                        (ct_event.get("userIdentity") or {}).get("arn")
                        or (ct_event.get("userIdentity") or {}).get("userName")
                        or evt.get("Username")
                    )
                    source_ip = ct_event.get("sourceIPAddress")
                    event_time = evt.get("EventTime", now)
                    resources = _dedupe_resources([
                        {"type": r.get("ResourceType"), "name": r.get("ResourceName")}
                        for r in (evt.get("Resources") or [])
                    ])

                    stmt = pg_insert(CloudTrailEvent).values(
                        id=uuid.uuid4(),
                        account_id=account.id,
                        event_id=event_id,
                        event_name=event_name,
                        event_source=event_source,
                        event_time=event_time,
                        actor=actor,
                        source_ip=source_ip,
                        resources=resources,
                        raw=ct_event,
                        last_seen=now,
                    ).on_conflict_do_update(
                        constraint="uq_cloudtrail_event_account_id",
                        set_={
                            "last_seen": now,
                            "raw": ct_event,
                            "event_name": event_name,
                            "event_source": event_source,
                        },
                    )
                    db.execute(stmt)
                    collected += 1
                    if collected >= _MAX_EVENTS_PER_RUN:
                        break

                if collected >= _MAX_EVENTS_PER_RUN:
                    break
        except ClientError as e:
            log.warning(
                "cloudtrail_events.lookup_failed",
                account_id=str(account.id),
                region=region,
                error_code=e.response.get("Error", {}).get("Code"),
            )
        except Exception as e:  # noqa: BLE001
            log.warning(
                "cloudtrail_events.error",
                account_id=str(account.id),
                region=region,
                error=str(e),
            )


    log.info(
        "cloudtrail_events.done",
        account_id=str(account.id),
        collected=collected,
        regions=len(regions),
        scanned=scanned,
        skipped_readonly=skipped_readonly,
        start=start.isoformat(),
    )
    return collected
