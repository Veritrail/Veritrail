"""Collect EKS cluster endpoint posture per region."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from botocore.exceptions import ClientError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.aws import assume_role
from app.models import AwsAccount
from app.models.resources import EksCluster

log = structlog.get_logger()

_REQUIRED_LOG_TYPES = frozenset({"api", "audit", "authenticator", "controllerManager", "scheduler"})


def _control_plane_logging_enabled(cluster: dict) -> bool:
    enabled_types: set[str] = set()
    for entry in (cluster.get("logging") or {}).get("clusterLogging") or []:
        if entry.get("enabled"):
            enabled_types.update(entry.get("types") or [])
    return _REQUIRED_LOG_TYPES.issubset(enabled_types)


def _secrets_encryption_enabled(cluster: dict) -> bool:
    for cfg in cluster.get("encryptionConfig") or []:
        if "secrets" in (cfg.get("resources") or []):
            return True
    return False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _get_regions(sess) -> list[str]:
    ec2 = sess.client("ec2", region_name="us-east-1")
    return [
        r["RegionName"]
        for r in ec2.describe_regions(
            Filters=[{"Name": "opt-in-status", "Values": ["opt-in-not-required", "opted-in"]}]
        )["Regions"]
    ]


def collect_eks(db: Session, account: AwsAccount) -> int:
    sess = assume_role(account.role_arn, account.external_id, session_name="vigil-eks", aws_account=account, purpose="collect_eks")
    count = 0
    for region in _get_regions(sess):
        try:
            eks = sess.client("eks", region_name=region)
            paginator = eks.get_paginator("list_clusters")
            for page in paginator.paginate():
                for name in page.get("clusters", []):
                    try:
                        cluster = eks.describe_cluster(name=name)["cluster"]
                    except ClientError:
                        continue
                    arn = cluster["arn"]
                    vpc_cfg = cluster.get("resourcesVpcConfig") or {}
                    cidrs = vpc_cfg.get("publicAccessCidrs") or []
                    logging_ok = _control_plane_logging_enabled(cluster)
                    secrets_ok = _secrets_encryption_enabled(cluster)
                    stmt = pg_insert(EksCluster).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{arn}"),
                        account_id=account.id,
                        region=region,
                        name=name,
                        arn=arn,
                        endpoint_public_access=bool(vpc_cfg.get("endpointPublicAccess")),
                        endpoint_private_access=bool(vpc_cfg.get("endpointPrivateAccess")),
                        public_access_cidrs=cidrs,
                        version=cluster.get("version"),
                        status=cluster.get("status"),
                        control_plane_logging_enabled=logging_ok,
                        secrets_encryption_enabled=secrets_ok,
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "arn"],
                        set_={
                            "endpoint_public_access": bool(vpc_cfg.get("endpointPublicAccess")),
                            "endpoint_private_access": bool(vpc_cfg.get("endpointPrivateAccess")),
                            "public_access_cidrs": cidrs,
                            "version": cluster.get("version"),
                            "status": cluster.get("status"),
                            "control_plane_logging_enabled": logging_ok,
                            "secrets_encryption_enabled": secrets_ok,
                            "last_seen": _now(),
                        },
                    )
                    db.execute(stmt)
                    count += 1
        except ClientError:
            continue
    db.commit()
    log.info("collect_eks.done", account_id=str(account.id), clusters=count)
    return count
