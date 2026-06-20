"""Collect IAM Identity Center (SSO) directory users."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from botocore.exceptions import ClientError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.aws import assume_role
from app.models import AwsAccount
from app.models.resources import IdentityCenterUser

log = structlog.get_logger()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_identity_center_dt(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def collect_identity_center(db: Session, account: AwsAccount) -> int:
    sess = assume_role(
        account.role_arn,
        account.external_id,
        session_name="vigil-identity-center",
        aws_account=account,
        purpose="collect_identity_center",
    )
    count = 0
    try:
        # IAM Identity Center instance metadata lives on sso-admin, not the OIDC "sso" client.
        sso_admin = sess.client("sso-admin", region_name="us-east-1")
        instances = sso_admin.list_instances().get("Instances", [])
    except ClientError as exc:
        log.info(
            "collect_identity_center.no_sso",
            account_id=str(account.id),
            error=exc.response.get("Error", {}).get("Code"),
        )
        return 0

    for inst in instances:
        store_id = inst.get("IdentityStoreId")
        if not store_id:
            continue
        try:
            idstore = sess.client("identitystore", region_name=inst.get("Region", "us-east-1"))
            paginator = idstore.get_paginator("list_users")
            for page in paginator.paginate(IdentityStoreId=store_id):
                for u in page.get("Users", []):
                    user_id = u.get("UserId", "")
                    if not user_id:
                        continue
                    emails = [e.get("Value") for e in u.get("Emails", []) if e.get("Value")]
                    meta = u.get("Meta") or {}
                    external_created_at = _parse_identity_center_dt(meta.get("CreatedAt"))
                    external_updated_at = _parse_identity_center_dt(meta.get("UpdatedAt"))
                    stmt = pg_insert(IdentityCenterUser).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:ic:{store_id}:{user_id}"),
                        account_id=account.id,
                        identity_store_id=store_id,
                        user_id=user_id,
                        user_name=u.get("UserName"),
                        display_name=u.get("DisplayName"),
                        email=emails[0] if emails else None,
                        active=u.get("Active", True),
                        external_created_at=external_created_at,
                        external_updated_at=external_updated_at,
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "identity_store_id", "user_id"],
                        set_={
                            "user_name": u.get("UserName"),
                            "display_name": u.get("DisplayName"),
                            "email": emails[0] if emails else None,
                            "active": u.get("Active", True),
                            "external_created_at": external_created_at,
                            "external_updated_at": external_updated_at,
                            "last_seen": _now(),
                        },
                    )
                    db.execute(stmt)
                    count += 1
        except ClientError:
            continue


    log.info("collect_identity_center.done", account_id=str(account.id), users=count)
    return count


def list_permission_set_snapshots(account: AwsAccount) -> list[dict]:
    """Read-only permission set metadata and account assignments for evidence snapshots."""
    sess = assume_role(
        account.role_arn,
        account.external_id,
        session_name="vigil-identity-center-ps",
        aws_account=account,
        purpose="collect_identity_center_permission_sets",
    )
    out: list[dict] = []
    try:
        sso_admin = sess.client("sso-admin", region_name="us-east-1")
        instances = sso_admin.list_instances().get("Instances", [])
    except ClientError as exc:
        log.info(
            "collect_identity_center.permission_sets_skipped",
            account_id=str(account.id),
            error=exc.response.get("Error", {}).get("Code"),
        )
        return out

    for inst in instances:
        instance_arn = inst.get("InstanceArn")
        identity_store_id = inst.get("IdentityStoreId")
        if not instance_arn:
            continue
        region = inst.get("Region", "us-east-1")
        admin = sess.client("sso-admin", region_name=region)
        token: str | None = None
        while True:
            kwargs: dict = {"InstanceArn": instance_arn, "MaxResults": 100}
            if token:
                kwargs["NextToken"] = token
            try:
                page = admin.list_permission_sets(**kwargs)
            except ClientError:
                break
            for ps_arn in page.get("PermissionSets", []):
                try:
                    desc = admin.describe_permission_set(
                        InstanceArn=instance_arn,
                        PermissionSetArn=ps_arn,
                    ).get("PermissionSet", {})
                except ClientError:
                    continue
                assignments: list[dict] = []
                account_ids: list[str] = []
                try:
                    account_token: str | None = None
                    while True:
                        account_kwargs: dict = {
                            "InstanceArn": instance_arn,
                            "PermissionSetArn": ps_arn,
                            "MaxResults": 100,
                        }
                        if account_token:
                            account_kwargs["NextToken"] = account_token
                        account_page = admin.list_accounts_for_provisioned_permission_set(**account_kwargs)
                        account_ids.extend(account_page.get("AccountIds", []))
                        account_token = account_page.get("NextToken")
                        if not account_token:
                            break
                except ClientError:
                    account_ids = []

                for aws_account_id in account_ids:
                    try:
                        assignment_token: str | None = None
                        while True:
                            assignment_kwargs: dict = {
                                "InstanceArn": instance_arn,
                                "AccountId": aws_account_id,
                                "PermissionSetArn": ps_arn,
                                "MaxResults": 100,
                            }
                            if assignment_token:
                                assignment_kwargs["NextToken"] = assignment_token
                            assignment_page = admin.list_account_assignments(**assignment_kwargs)
                            for assignment in assignment_page.get("AccountAssignments", []):
                                assignments.append(
                                    _assignment_snapshot(
                                        sess,
                                        identity_store_id=identity_store_id,
                                        region=region,
                                        assignment=assignment,
                                    )
                                )
                            assignment_token = assignment_page.get("NextToken")
                            if not assignment_token:
                                break
                    except ClientError:
                        continue

                out.append(
                    {
                        "permission_set_arn": ps_arn,
                        "instance_arn": instance_arn,
                        "identity_store_id": identity_store_id,
                        "region": region,
                        "name": desc.get("Name"),
                        "description": desc.get("Description"),
                        "session_duration": desc.get("SessionDuration"),
                        "relay_state": desc.get("RelayState"),
                        "provisioned_account_ids": sorted(set(account_ids)),
                        "account_assignments": assignments,
                        "assignment_count": len(assignments),
                    }
                )
            token = page.get("NextToken")
            if not token:
                break
    log.info(
        "collect_identity_center.permission_sets",
        account_id=str(account.id),
        count=len(out),
    )
    return out


def _assignment_snapshot(
    sess,
    *,
    identity_store_id: str | None,
    region: str,
    assignment: dict,
) -> dict:
    principal_id = assignment.get("PrincipalId")
    principal_type = assignment.get("PrincipalType")
    out = {
        "account_id": assignment.get("AccountId"),
        "permission_set_arn": assignment.get("PermissionSetArn"),
        "principal_id": principal_id,
        "principal_type": principal_type,
    }
    if not identity_store_id or not principal_id:
        return out

    try:
        idstore = sess.client("identitystore", region_name=region)
        if principal_type == "USER":
            user = idstore.describe_user(IdentityStoreId=identity_store_id, UserId=principal_id)
            emails = [e.get("Value") for e in user.get("Emails", []) if e.get("Value")]
            out["principal"] = {
                "user_name": user.get("UserName"),
                "display_name": user.get("DisplayName"),
                "email": emails[0] if emails else None,
            }
        elif principal_type == "GROUP":
            group = idstore.describe_group(IdentityStoreId=identity_store_id, GroupId=principal_id)
            out["principal"] = {
                "display_name": group.get("DisplayName"),
                "description": group.get("Description"),
            }
    except ClientError:
        pass
    return out
