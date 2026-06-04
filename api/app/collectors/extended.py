"""Collectors for AWS gap-check resources: ACM, Lambda, ECR, Secrets, SSM, ELB, DynamoDB, SNS, SQS."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

import structlog
from botocore.exceptions import ClientError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.aws import assume_role
from app.models import AwsAccount
from app.models.resources import (
    AcmCertificate,
    DynamoDbTable,
    EcrRepository,
    ElbLoadBalancer,
    LambdaFunction,
    SecretsManagerSecret,
    SnsTopic,
    SqsQueue,
    SsmParameter,
)

log = structlog.get_logger()

# Runtimes AWS has marked deprecated / EOL (extend as AWS publishes new EOL dates).
DEPRECATED_LAMBDA_RUNTIMES = frozenset({
    "python3.8", "python3.7", "python3.6",
    "nodejs16.x", "nodejs14.x", "nodejs12.x", "nodejs10.x",
    "ruby2.7", "ruby2.5",
    "java8", "java8.al2",
    "dotnetcore3.1", "dotnetcore2.1",
    "go1.x",
})

_WEAK_TLS_PREFIXES = ("ELBSecurityPolicy-2011-", "ELBSecurityPolicy-2014-", "ELBSecurityPolicy-2015-")


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


def _is_weak_tls_policy(policy: str | None) -> bool:
    if not policy:
        return False
    return any(policy.startswith(p) for p in _WEAK_TLS_PREFIXES) or policy in {
        "ELBSecurityPolicy-TLS-1-0-2015-04",
        "ELBSecurityPolicy-TLS-1-1-2017-01",
    }


def collect_acm(db: Session, account: AwsAccount) -> int:
    sess = assume_role(account.role_arn, account.external_id, session_name="vigil-acm", aws_account=account, purpose="collect_acm")
    count = 0
    for region in _get_regions(sess):
        try:
            acm = sess.client("acm", region_name=region)
            paginator = acm.get_paginator("list_certificates")
            for page in paginator.paginate(CertificateStatuses=["ISSUED", "EXPIRED", "INACTIVE"]):
                for summary in page.get("CertificateSummaryList", []):
                    arn = summary["CertificateArn"]
                    try:
                        cert = acm.describe_certificate(CertificateArn=arn)["Certificate"]
                    except ClientError:
                        continue
                    expires = cert.get("NotAfter")
                    if expires and expires.tzinfo is None:
                        expires = expires.replace(tzinfo=timezone.utc)
                    stmt = pg_insert(AcmCertificate).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{arn}"),
                        account_id=account.id,
                        region=region,
                        certificate_arn=arn,
                        domain_name=cert.get("DomainName"),
                        expires_at=expires,
                        status=cert.get("Status"),
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "certificate_arn"],
                        set_={
                            "domain_name": cert.get("DomainName"),
                            "expires_at": expires,
                            "status": cert.get("Status"),
                            "last_seen": _now(),
                        },
                    )
                    db.execute(stmt)
                    count += 1
        except ClientError:
            continue
    db.commit()
    log.info("collect_acm.done", account_id=str(account.id), certificates=count)
    return count


def collect_lambda(db: Session, account: AwsAccount) -> int:
    sess = assume_role(account.role_arn, account.external_id, session_name="vigil-lambda", aws_account=account, purpose="collect_lambda")
    count = 0
    for region in _get_regions(sess):
        try:
            lam = sess.client("lambda", region_name=region)
            paginator = lam.get_paginator("list_functions")
            for page in paginator.paginate():
                for fn in page.get("Functions", []):
                    arn = fn["FunctionArn"]
                    name = fn["FunctionName"]
                    url_cfg = {}
                    try:
                        url_cfg = lam.get_function_url_config(FunctionName=name)
                    except ClientError:
                        pass
                    has_dlq = False
                    try:
                        cfg = lam.get_function_event_invoke_config(FunctionName=name)
                        has_dlq = bool(cfg.get("DestinationConfig", {}).get("OnFailure", {}).get("Destination"))
                    except ClientError:
                        pass
                    stmt = pg_insert(LambdaFunction).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{arn}"),
                        account_id=account.id,
                        region=region,
                        function_name=name,
                        arn=arn,
                        runtime=fn.get("Runtime"),
                        has_dlq=has_dlq,
                        function_url=url_cfg.get("FunctionUrl"),
                        function_url_auth_type=url_cfg.get("AuthType"),
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "arn"],
                        set_={
                            "runtime": fn.get("Runtime"),
                            "has_dlq": has_dlq,
                            "function_url": url_cfg.get("FunctionUrl"),
                            "function_url_auth_type": url_cfg.get("AuthType"),
                            "last_seen": _now(),
                        },
                    )
                    db.execute(stmt)
                    count += 1
        except ClientError:
            continue
    db.commit()
    log.info("collect_lambda.done", account_id=str(account.id), functions=count)
    return count


def collect_ecr(db: Session, account: AwsAccount) -> int:
    sess = assume_role(account.role_arn, account.external_id, session_name="vigil-ecr", aws_account=account, purpose="collect_ecr")
    count = 0
    for region in _get_regions(sess):
        try:
            ecr = sess.client("ecr", region_name=region)
            paginator = ecr.get_paginator("describe_repositories")
            for page in paginator.paginate():
                for repo in page.get("repositories", []):
                    arn = repo["repositoryArn"]
                    scanning = repo.get("imageScanningConfiguration") or {}
                    encryption = repo.get("encryptionConfiguration") or {}
                    scan_on_push = bool(scanning.get("scanOnPush"))
                    stmt = pg_insert(EcrRepository).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{arn}"),
                        account_id=account.id,
                        region=region,
                        repository_name=repo.get("repositoryName", arn),
                        repository_arn=arn,
                        scan_on_push=scan_on_push,
                        encryption_type=encryption.get("encryptionType"),
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "repository_arn"],
                        set_={
                            "repository_name": repo.get("repositoryName", arn),
                            "scan_on_push": scan_on_push,
                            "encryption_type": encryption.get("encryptionType"),
                            "last_seen": _now(),
                        },
                    )
                    db.execute(stmt)
                    count += 1
        except ClientError:
            continue
    db.commit()
    log.info("collect_ecr.done", account_id=str(account.id), repositories=count)
    return count


def collect_secrets(db: Session, account: AwsAccount) -> int:
    sess = assume_role(account.role_arn, account.external_id, session_name="vigil-secrets", aws_account=account, purpose="collect_secrets")
    count = 0
    for region in _get_regions(sess):
        try:
            sm = sess.client("secretsmanager", region_name=region)
            paginator = sm.get_paginator("list_secrets")
            for page in paginator.paginate():
                for secret in page.get("SecretList", []):
                    arn = secret["ARN"]
                    rotation_enabled = secret.get("RotationEnabled", False)
                    stmt = pg_insert(SecretsManagerSecret).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{arn}"),
                        account_id=account.id,
                        region=region,
                        secret_arn=arn,
                        name=secret.get("Name", arn),
                        rotation_enabled=rotation_enabled,
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "secret_arn"],
                        set_={"rotation_enabled": rotation_enabled, "last_seen": _now()},
                    )
                    db.execute(stmt)
                    count += 1
        except ClientError:
            continue
    db.commit()
    log.info("collect_secrets.done", account_id=str(account.id), secrets=count)
    return count


def collect_ssm_parameters(db: Session, account: AwsAccount) -> int:
    sess = assume_role(account.role_arn, account.external_id, session_name="vigil-ssm", aws_account=account, purpose="collect_ssm_parameters")
    count = 0
    for region in _get_regions(sess):
        try:
            ssm = sess.client("ssm", region_name=region)
            paginator = ssm.get_paginator("describe_parameters")
            for page in paginator.paginate():
                for param in page.get("Parameters", []):
                    name = param["Name"]
                    ptype = param.get("Type", "String")
                    stmt = pg_insert(SsmParameter).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{region}:{name}"),
                        account_id=account.id,
                        region=region,
                        parameter_name=name,
                        parameter_type=ptype,
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "region", "parameter_name"],
                        set_={"parameter_type": ptype, "last_seen": _now()},
                    )
                    db.execute(stmt)
                    count += 1
        except ClientError:
            continue
    db.commit()
    log.info("collect_ssm_parameters.done", account_id=str(account.id), parameters=count)
    return count


def collect_elb(db: Session, account: AwsAccount) -> int:
    sess = assume_role(account.role_arn, account.external_id, session_name="vigil-elb", aws_account=account, purpose="collect_elb")
    count = 0
    for region in _get_regions(sess):
        try:
            elbv2 = sess.client("elbv2", region_name=region)
            paginator = elbv2.get_paginator("describe_load_balancers")
            for page in paginator.paginate():
                for lb in page.get("LoadBalancers", []):
                    arn = lb["LoadBalancerArn"]
                    attrs = elbv2.describe_load_balancer_attributes(LoadBalancerArn=arn)["Attributes"]
                    attr_map = {a["Key"]: a["Value"] for a in attrs}
                    access_logs = attr_map.get("access_logs.s3.enabled", "false") == "true"
                    ssl_policy = None
                    try:
                        listeners = elbv2.describe_listeners(LoadBalancerArn=arn).get("Listeners", [])
                        for listener in listeners:
                            if listener.get("Protocol") in ("HTTPS", "TLS"):
                                ssl_policy = listener.get("SslPolicy")
                                break
                    except ClientError:
                        pass
                    stmt = pg_insert(ElbLoadBalancer).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{arn}"),
                        account_id=account.id,
                        region=region,
                        load_balancer_arn=arn,
                        name=lb.get("LoadBalancerName", arn),
                        lb_type=lb.get("Type", "application"),
                        access_logs_enabled=access_logs,
                        ssl_policy=ssl_policy,
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "load_balancer_arn"],
                        set_={
                            "access_logs_enabled": access_logs,
                            "ssl_policy": ssl_policy,
                            "last_seen": _now(),
                        },
                    )
                    db.execute(stmt)
                    count += 1
        except ClientError:
            continue
    db.commit()
    log.info("collect_elb.done", account_id=str(account.id), load_balancers=count)
    return count


def collect_dynamodb(db: Session, account: AwsAccount) -> int:
    sess = assume_role(account.role_arn, account.external_id, session_name="vigil-dynamodb", aws_account=account, purpose="collect_dynamodb")
    count = 0
    for region in _get_regions(sess):
        try:
            ddb = sess.client("dynamodb", region_name=region)
            paginator = ddb.get_paginator("list_tables")
            for page in paginator.paginate():
                for table_name in page.get("TableNames", []):
                    try:
                        table = ddb.describe_table(TableName=table_name)["Table"]
                    except ClientError:
                        continue
                    arn = table["TableArn"]
                    sse = table.get("SSEDescription") or {}
                    sse_status = sse.get("Status", "")
                    sse_type = sse.get("SSEType", "")
                    kms_encrypted = sse_status == "ENABLED" and sse_type in ("KMS", "AES256")
                    pitr_enabled = False
                    try:
                        backups = ddb.describe_continuous_backups(TableName=table_name)["ContinuousBackupsDescription"]
                        pitr = backups.get("PointInTimeRecoveryDescription", {})
                        pitr_enabled = pitr.get("PointInTimeRecoveryStatus") == "ENABLED"
                    except ClientError:
                        pass
                    stmt = pg_insert(DynamoDbTable).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{arn}"),
                        account_id=account.id,
                        region=region,
                        table_name=table_name,
                        arn=arn,
                        pitr_enabled=pitr_enabled,
                        kms_encrypted=kms_encrypted,
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "arn"],
                        set_={
                            "pitr_enabled": pitr_enabled,
                            "kms_encrypted": kms_encrypted,
                            "last_seen": _now(),
                        },
                    )
                    db.execute(stmt)
                    count += 1
        except ClientError:
            continue
    db.commit()
    log.info("collect_dynamodb.done", account_id=str(account.id), tables=count)
    return count


def collect_sns(db: Session, account: AwsAccount) -> int:
    sess = assume_role(account.role_arn, account.external_id, session_name="vigil-sns", aws_account=account, purpose="collect_sns")
    count = 0
    for region in _get_regions(sess):
        try:
            sns = sess.client("sns", region_name=region)
            paginator = sns.get_paginator("list_topics")
            for page in paginator.paginate():
                for topic in page.get("Topics", []):
                    arn = topic["TopicArn"]
                    try:
                        attrs = sns.get_topic_attributes(TopicArn=arn)["Attributes"]
                    except ClientError:
                        continue
                    kms_encrypted = bool(attrs.get("KmsMasterKeyId"))
                    stmt = pg_insert(SnsTopic).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{arn}"),
                        account_id=account.id,
                        region=region,
                        topic_arn=arn,
                        kms_encrypted=kms_encrypted,
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "topic_arn"],
                        set_={"kms_encrypted": kms_encrypted, "last_seen": _now()},
                    )
                    db.execute(stmt)
                    count += 1
        except ClientError:
            continue
    db.commit()
    log.info("collect_sns.done", account_id=str(account.id), topics=count)
    return count


def collect_sqs(db: Session, account: AwsAccount) -> int:
    sess = assume_role(account.role_arn, account.external_id, session_name="vigil-sqs", aws_account=account, purpose="collect_sqs")
    count = 0
    for region in _get_regions(sess):
        try:
            sqs = sess.client("sqs", region_name=region)
            paginator = sqs.get_paginator("list_queues")
            for page in paginator.paginate():
                for queue_url in page.get("QueueUrls", []):
                    try:
                        attrs = sqs.get_queue_attributes(
                            QueueUrl=queue_url,
                            AttributeNames=["QueueArn", "KmsMasterKeyId"],
                        )["Attributes"]
                    except ClientError:
                        continue
                    arn = attrs.get("QueueArn", queue_url)
                    kms_encrypted = bool(attrs.get("KmsMasterKeyId"))
                    stmt = pg_insert(SqsQueue).values(
                        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{arn}"),
                        account_id=account.id,
                        region=region,
                        queue_url=queue_url,
                        queue_arn=arn,
                        kms_encrypted=kms_encrypted,
                        last_seen=_now(),
                    ).on_conflict_do_update(
                        index_elements=["account_id", "queue_arn"],
                        set_={"kms_encrypted": kms_encrypted, "last_seen": _now()},
                    )
                    db.execute(stmt)
                    count += 1
        except ClientError:
            continue
    db.commit()
    log.info("collect_sqs.done", account_id=str(account.id), queues=count)
    return count


def is_deprecated_lambda_runtime(runtime: str | None) -> bool:
    return runtime in DEPRECATED_LAMBDA_RUNTIMES if runtime else False


def is_weak_tls_policy(policy: str | None) -> bool:
    return _is_weak_tls_policy(policy)


_SENSITIVE_PARAM_RE = re.compile(r"(secret|password|passwd|token|apikey|api_key|credential)", re.I)


def looks_like_secret_parameter(name: str) -> bool:
    return bool(_SENSITIVE_PARAM_RE.search(name))
