"""Collect ECS cluster, service, and in-use task definition posture per region."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from botocore.exceptions import ClientError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.aws import assume_role
from app.models import AwsAccount
from app.models.resources import EcsCluster, EcsService, EcsTaskDefinition

log = structlog.get_logger()


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


def _container_insights_enabled(cluster: dict) -> bool:
    for setting in cluster.get("settings") or []:
        if setting.get("name") == "containerInsights":
            return str(setting.get("value", "")).lower() == "enabled"
    return False


def _assign_public_ip(service: dict) -> str | None:
    net = (service.get("networkConfiguration") or {}).get("awsvpcConfiguration") or {}
    return net.get("assignPublicIp")


def _task_def_has_privileged(task_def: dict) -> bool:
    for container in task_def.get("containerDefinitions") or []:
        if container.get("privileged"):
            return True
    return False


def collect_ecs(db: Session, account: AwsAccount) -> dict:
    sess = assume_role(
        account.role_arn,
        account.external_id,
        session_name="veritrail-ecs",
        aws_account=account,
        purpose="collect_ecs",
    )
    cluster_count = service_count = task_def_count = 0
    seen_task_defs: set[str] = set()

    for region in _get_regions(sess):
        try:
            ecs = sess.client("ecs", region_name=region)
            cluster_arns: list[str] = []
            paginator = ecs.get_paginator("list_clusters")
            for page in paginator.paginate():
                cluster_arns.extend(page.get("clusterArns") or [])

            if not cluster_arns:
                continue

            for batch_start in range(0, len(cluster_arns), 100):
                batch = cluster_arns[batch_start : batch_start + 100]
                described = ecs.describe_clusters(clusters=batch, include=["SETTINGS"]).get("clusters") or []
                for cluster in described:
                    arn = cluster.get("clusterArn")
                    name = cluster.get("clusterName")
                    if not arn or not name:
                        continue
                    insights = _container_insights_enabled(cluster)
                    stmt = pg_insert(EcsCluster).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{arn}"),
                        account_id=account.id,
                        region=region,
                        name=name,
                        arn=arn,
                        container_insights_enabled=insights,
                        status=cluster.get("status"),
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "arn"],
                        set_={
                            "container_insights_enabled": insights,
                            "status": cluster.get("status"),
                            "last_seen": _now(),
                        },
                    )
                    db.execute(stmt)
                    cluster_count += 1

                    service_arns: list[str] = []
                    svc_paginator = ecs.get_paginator("list_services")
                    for svc_page in svc_paginator.paginate(cluster=arn):
                        service_arns.extend(svc_page.get("serviceArns") or [])

                    for svc_start in range(0, len(service_arns), 10):
                        svc_batch = service_arns[svc_start : svc_start + 10]
                        services = ecs.describe_services(cluster=arn, services=svc_batch).get("services") or []
                        for service in services:
                            svc_arn = service.get("serviceArn")
                            svc_name = service.get("serviceName")
                            if not svc_arn or not svc_name:
                                continue
                            assign_public_ip = _assign_public_ip(service)
                            stmt = pg_insert(EcsService).values(
                                id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{svc_arn}"),
                                account_id=account.id,
                                region=region,
                                cluster_arn=arn,
                                cluster_name=name,
                                service_name=svc_name,
                                service_arn=svc_arn,
                                assign_public_ip=assign_public_ip,
                                launch_type=service.get("launchType"),
                                status=service.get("status"),
                                task_definition_arn=service.get("taskDefinition"),
                                last_seen=_now(),
                            ).on_conflict_do_update(
                                index_elements=["account_id", "service_arn"],
                                set_={
                                    "cluster_name": name,
                                    "assign_public_ip": assign_public_ip,
                                    "launch_type": service.get("launchType"),
                                    "status": service.get("status"),
                                    "task_definition_arn": service.get("taskDefinition"),
                                    "last_seen": _now(),
                                },
                            )
                            db.execute(stmt)
                            service_count += 1

                            task_def_arn = service.get("taskDefinition")
                            if not task_def_arn or task_def_arn in seen_task_defs:
                                continue
                            seen_task_defs.add(task_def_arn)
                            try:
                                task_def = ecs.describe_task_definition(taskDefinition=task_def_arn)[
                                    "taskDefinition"
                                ]
                            except ClientError:
                                continue
                            privileged = _task_def_has_privileged(task_def)
                            family = task_def.get("family") or task_def_arn.rsplit("/", 1)[-1]
                            revision = task_def.get("revision")
                            stmt = pg_insert(EcsTaskDefinition).values(
                                id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{task_def_arn}"),
                                account_id=account.id,
                                region=region,
                                task_definition_arn=task_def_arn,
                                family=family,
                                revision=revision,
                                has_privileged_container=privileged,
                                last_seen=_now(),
                            ).on_conflict_do_update(
                                index_elements=["account_id", "task_definition_arn"],
                                set_={
                                    "family": family,
                                    "revision": revision,
                                    "has_privileged_container": privileged,
                                    "last_seen": _now(),
                                },
                            )
                            db.execute(stmt)
                            task_def_count += 1
        except ClientError:
            continue


    log.info(
        "collect_ecs.done",
        account_id=str(account.id),
        clusters=cluster_count,
        services=service_count,
        task_definitions=task_def_count,
    )
    return {
        "clusters": cluster_count,
        "services": service_count,
        "task_definitions": task_def_count,
    }
