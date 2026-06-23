"""Collect IAM server certificates (CIS 1.18)."""
from __future__ import annotations

import uuid
from datetime import timezone

import structlog
from botocore.exceptions import ClientError
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.aws import assume_role
from app.models import AwsAccount
from app.models.resources import IamServerCertificate

log = structlog.get_logger()


def collect_iam_server_certificates(db: Session, account: AwsAccount) -> int:
    log.info("collect_iam_server_certs.start", account_id=str(account.id))
    count = 0
    try:
        sess = assume_role(
            account.role_arn,
            account.external_id,
            session_name="veritrail-iam-certs",
            aws_account=account,
            purpose="collect_iam_server_certificates",
        )
        iam = sess.client("iam")
        marker = None
        while True:
            kwargs = {}
            if marker:
                kwargs["Marker"] = marker
            resp = iam.list_server_certificates(**kwargs)
            for meta in resp.get("ServerCertificateMetadataList", []):
                name = meta["ServerCertificateName"]
                arn = meta["Arn"]
                expires = meta.get("Expiration")
                if expires is not None and expires.tzinfo is None:
                    expires = expires.replace(tzinfo=timezone.utc)
                stmt = pg_insert(IamServerCertificate).values(
                    id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{arn}"),
                    account_id=account.id,
                    name=name,
                    arn=arn,
                    expires_at=expires,
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements=["account_id", "arn"],
                    set_={
                        "name": stmt.excluded.name,
                        "expires_at": stmt.excluded.expires_at,
                        "last_seen": func.now(),
                    },
                )
                db.execute(stmt)
                count += 1
            if not resp.get("IsTruncated"):
                break
            marker = resp.get("Marker")
    except ClientError as e:
        log.warning("collect_iam_server_certs.failed", account_id=str(account.id), error=str(e))


    log.info("collect_iam_server_certs.done", account_id=str(account.id), count=count)
    return count
