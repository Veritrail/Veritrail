"""Collect AWS account contact information (CIS 1.1, 1.2)."""
from __future__ import annotations

import uuid

import structlog
from botocore.exceptions import ClientError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.aws import assume_role
from app.models import AwsAccount
from app.models.resources import AccountGovernance

log = structlog.get_logger()


def _contact_complete(info: dict | None) -> bool:
    if not info:
        return False
    address = (info.get("AddressLine1") or "").strip()
    city = (info.get("City") or "").strip()
    country = (info.get("CountryCode") or "").strip()
    phone = (info.get("PhoneNumber") or "").strip()
    return bool(address and city and country and phone)


def _alternate_complete(contact: dict | None) -> bool:
    if not contact:
        return False
    email = (contact.get("EmailAddress") or "").strip()
    phone = (contact.get("PhoneNumber") or "").strip()
    return bool(email and phone)


def collect_account_governance(db: Session, account: AwsAccount) -> dict:
    log.info("collect_account_governance.start", account_id=str(account.id))
    primary_ok = False
    security_ok = False
    snapshot: dict = {}
    error_msg: str | None = None

    try:
        sess = assume_role(
            account.role_arn,
            account.external_id,
            session_name="vigil-account-gov",
            aws_account=account,
            purpose="collect_account_governance",
        )
        acct = sess.client("account", region_name="us-east-1")

        try:
            primary = acct.get_contact_information().get("ContactInformation")
            snapshot["primary"] = primary
            primary_ok = _contact_complete(primary)
        except ClientError as e:
            snapshot["primary_error"] = str(e)

        try:
            sec = acct.get_alternate_contact(AlternateContactType="SECURITY").get("AlternateContact")
            snapshot["security"] = sec
            security_ok = _alternate_complete(sec)
        except ClientError as e:
            snapshot["security_error"] = str(e)

    except ClientError as e:
        error_msg = str(e)[:500]
        log.warning("collect_account_governance.failed", account_id=str(account.id), error=error_msg)

    stmt = pg_insert(AccountGovernance).values(
        id=uuid.uuid4(),
        account_id=account.id,
        primary_contact_complete=primary_ok,
        security_contact_complete=security_ok,
        collection_error=error_msg,
        contact_snapshot=snapshot or None,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["account_id"],
        set_={
            "primary_contact_complete": stmt.excluded.primary_contact_complete,
            "security_contact_complete": stmt.excluded.security_contact_complete,
            "collection_error": stmt.excluded.collection_error,
            "contact_snapshot": stmt.excluded.contact_snapshot,
            "last_seen": stmt.excluded.last_seen,
        },
    )
    db.execute(stmt)

    log.info(
        "collect_account_governance.done",
        account_id=str(account.id),
        primary_ok=primary_ok,
        security_ok=security_ok,
    )
    return {"account_governance": 1, "primary_contact_complete": primary_ok, "security_contact_complete": security_ok}
