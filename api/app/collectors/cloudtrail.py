"""Collect CloudTrail trail configuration."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from botocore.exceptions import ClientError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.collectors.cloudtrail_shared import _get_regions
from app.core.aws import assume_role
from app.models import AwsAccount
from app.models.resources import CloudTrailTrail

log = structlog.get_logger()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _discover_trails(sess) -> list[dict]:
    """Return trail metadata from every opted-in region (deduped by ARN).

    describe_trails is region-scoped; a trail whose home region is not us-east-1
    is invisible to a single-region collector. get_trail_status must run in the
    trail's home region.
    """
    seen: set[str] = set()
    trails: list[dict] = []
    for region in _get_regions(sess):
        try:
            ct = sess.client("cloudtrail", region_name=region)
            for t in ct.describe_trails(includeShadowTrails=False).get("trailList", []):
                arn = t.get("TrailARN", "")
                if not arn or arn in seen:
                    continue
                seen.add(arn)
                trails.append(t)
        except ClientError as e:
            log.warning(
                "collect_cloudtrail.describe_failed",
                region=region,
                error_code=e.response.get("Error", {}).get("Code"),
            )
    return trails


def _check_org_trail_coverage(sess) -> tuple[bool, str | None]:
    """Check if this account is covered by an organization trail.

    AWS Organizations trails span all member accounts but are configured only
    in the management account. Member accounts won't have their own trails but
    are still covered — we detect this two ways:

    1. Check if any existing trail has IsOrganizationTrail=True (visible from
       management account only, but also visible in member accounts if the
       org trail is multi-region).
    2. Check if the account is a delegated CloudTrail administrator via
       organizations:DescribeOrganization or organizations:ListDelegatedAdministrators.

    Returns (is_covered, management_account_id | None).
    """
    # Method 1: Check existing trails for IsOrganizationTrail
    for region in _get_regions(sess):
        try:
            ct = sess.client("cloudtrail", region_name=region)
            for t in ct.describe_trails(includeShadowTrails=False).get("trailList", []):
                if t.get("IsOrganizationTrail", False):
                    # The trail ARN format: arn:aws:cloudtrail:region:MANAGEMENT_ACCOUNT:trail/name
                    arn = t.get("TrailARN", "")
                    mgmt_id = arn.split(":")[4] if ":" in arn else None
                    return True, mgmt_id
        except ClientError:
            continue

    # Method 2: Check organizations API to see if this is a member account
    try:
        org = sess.client("organizations", region_name="us-east-1")
        # DescribeOrganization tells us the management account ID
        org_info = org.describe_organization().get("Organization", {})
        mgmt_id = org_info.get("MasterAccountId") or org_info.get("ManagementAccountId")
        # If this call succeeds, we're in an organization — check for
        # delegated CloudTrail administrators
        try:
            delegated = org.list_delegated_administrators(
                ServicePrincipal="cloudtrail.amazonaws.com"
            ).get("DelegatedAdministrators", [])
            if delegated:
                # A delegated admin exists — org trails may be managed from there
                return True, mgmt_id
        except ClientError:
            pass
    except ClientError:
        # organizations:DescribeOrganization fails if not in an org or
        # no permissions — this is expected; don't log as error
        pass

    return False, None


def _trail_is_logging(sess, trail: dict) -> bool:
    home_region = trail.get("HomeRegion") or "us-east-1"
    name = trail.get("Name", "")
    arn = trail.get("TrailARN", "")
    ct = sess.client("cloudtrail", region_name=home_region)
    for identifier in (name, arn):
        if not identifier:
            continue
        try:
            return bool(ct.get_trail_status(Name=identifier).get("IsLogging", False))
        except ClientError:
            continue
    return False


def _inspect_s3_bucket(sess, bucket_name: str) -> tuple[bool, bool]:
    """Return (s3_bucket_public, s3_bucket_logging_enabled)."""
    s3_bucket_public = False
    s3_bucket_logging_enabled = False
    s3 = sess.client("s3", region_name="us-east-1")
    try:
        pab = s3.get_public_access_block(Bucket=bucket_name).get("PublicAccessBlockConfiguration", {})
        s3_bucket_public = not all([
            pab.get("BlockPublicAcls", False),
            pab.get("IgnorePublicAcls", False),
            pab.get("BlockPublicPolicy", False),
            pab.get("RestrictPublicBuckets", False),
        ])
    except ClientError:
        try:
            acl = s3.get_bucket_acl(Bucket=bucket_name)
            for grant in acl.get("Grants", []):
                grantee = grant.get("Grantee", {})
                if grantee.get("URI") == "http://acs.amazonaws.com/groups/global/AllUsers":
                    s3_bucket_public = True
                    break
        except ClientError:
            pass
    try:
        log_cfg = s3.get_bucket_logging(Bucket=bucket_name).get("LoggingEnabled")
        s3_bucket_logging_enabled = log_cfg is not None
    except ClientError:
        pass
    return s3_bucket_public, s3_bucket_logging_enabled


def collect_cloudtrail(db: Session, account: AwsAccount) -> int:
    sess = assume_role(
        account.role_arn,
        account.external_id,
        session_name="vigil-cloudtrail",
        aws_account=account,
        purpose="collect_cloudtrail",
    )
    count = 0

    # Check if this account is covered by an organization trail
    org_covered, mgmt_id = _check_org_trail_coverage(sess)

    for t in _discover_trails(sess):
        arn = t.get("TrailARN", "")
        name = t.get("Name", "")
        home_region = t.get("HomeRegion", "us-east-1")
        is_multi_region = t.get("IsMultiRegionTrail", False)
        is_org_trail = t.get("IsOrganizationTrail", False)
        log_validation = t.get("LogFileValidationEnabled", False)
        kms_key_id = t.get("KmsKeyId")
        s3_bucket_name = t.get("S3BucketName")
        cloudwatch_logs_enabled = bool(t.get("CloudWatchLogsLogGroupArn"))

        # Derive management account ID from org trail ARN if available
        trail_mgmt_id = arn.split(":")[4] if is_org_trail and ":" in arn else (mgmt_id if org_covered else None)

        s3_bucket_public = False
        s3_bucket_logging_enabled = False
        if s3_bucket_name:
            s3_bucket_public, s3_bucket_logging_enabled = _inspect_s3_bucket(sess, s3_bucket_name)

        is_logging = _trail_is_logging(sess, t)

        stmt = pg_insert(CloudTrailTrail).values(
            id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{arn}"),
            account_id=account.id,
            arn=arn,
            name=name,
            home_region=home_region,
            is_multi_region=is_multi_region,
            is_logging=is_logging,
            log_validation_enabled=log_validation,
            kms_key_id=kms_key_id,
            s3_bucket_name=s3_bucket_name,
            s3_bucket_public=s3_bucket_public,
            s3_bucket_logging_enabled=s3_bucket_logging_enabled,
            cloudwatch_logs_enabled=cloudwatch_logs_enabled,
            is_organization_trail=is_org_trail,
            management_account_id=trail_mgmt_id,
            last_seen=_now(),
        ).on_conflict_do_update(
            index_elements=["account_id", "arn"],
            set_={
                "is_multi_region": is_multi_region,
                "is_logging": is_logging,
                "log_validation_enabled": log_validation,
                "kms_key_id": kms_key_id,
                "s3_bucket_name": s3_bucket_name,
                "s3_bucket_public": s3_bucket_public,
                "s3_bucket_logging_enabled": s3_bucket_logging_enabled,
                "cloudwatch_logs_enabled": cloudwatch_logs_enabled,
                "is_organization_trail": is_org_trail,
                "management_account_id": trail_mgmt_id,
                "last_seen": _now(),
            },
        )
        db.execute(stmt)
        count += 1

    # If no trails were found but org trail coverage was detected, record a
    # synthetic trail entry so the check module knows about org coverage
    if count == 0 and org_covered:
        sid = f"{account.id}:org-trail"
        stmt = pg_insert(CloudTrailTrail).values(
            id=uuid.uuid5(uuid.NAMESPACE_URL, sid),
            account_id=account.id,
            arn=f"arn:aws:cloudtrail:*:{mgmt_id or 'unknown'}:trail/org-trail",
            name="org-trail",
            home_region="us-east-1",
            is_multi_region=True,
            is_logging=True,
            is_organization_trail=True,
            management_account_id=mgmt_id,
            last_seen=_now(),
        ).on_conflict_do_update(
            index_elements=["account_id", "arn"],
            set_={
                "is_multi_region": True,
                "is_logging": True,
                "is_organization_trail": True,
                "management_account_id": mgmt_id,
                "last_seen": _now(),
            },
        )
        db.execute(stmt)
        count += 1

    db.commit()
    log.info("collect_cloudtrail.done", account_id=str(account.id), trails=count, org_covered=org_covered)
    return count
