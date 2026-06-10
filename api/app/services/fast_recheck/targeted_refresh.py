"""Refresh a single finding's AWS resource (or small scope) before re-running its check."""
from __future__ import annotations

import uuid
from typing import Any

import structlog
from botocore.exceptions import ClientError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.collectors.account import collect_s3_account_public_access_block
from app.collectors.account_governance import collect_account_governance
from app.collectors.access_analyzer import collect_access_analyzer
from app.collectors.config_service import collect_config_service
from app.collectors.guardduty import collect_guardduty
from app.collectors.iam import collect_iam
from app.collectors.iam_server_certificates import collect_iam_server_certificates
from app.collectors.securityhub import collect_securityhub
from app.collectors.sg_ingress import build_public_exposure, has_public_port
from app.core.aws import assume_role
from app.core.aws_trust import parse_role_name
from app.models import AwsAccount, Finding
from app.models.resources import (
    EbsEncryptionDefault,
    EbsSnapshot,
    EbsVolume,
    Ec2Instance,
    KmsKey,
    LambdaFunction,
    RdsInstance,
    S3Bucket,
    SecurityGroup,
    SsmParameter,
    Vpc,
)
from app.services.fast_recheck.common import (
    arn_resource_id,
    evidence_str,
    now,
    resource_region,
    s3_bucket_name,
)

log = structlog.get_logger()

UNSUPPORTED_PREFIXES = ("github.", "gitlab.", "cloudtrail.event.")
UNSUPPORTED_CHECKS = frozenset({
    "iam.perm.granted_vs_used",
    "iam.access_inventory_gap",
    "iam.cloudshell_full_access_granted",
})


def _session(account: AwsAccount, purpose: str):
    return assume_role(
        account.role_arn,
        account.external_id,
        session_name="vigil-fast-recheck",
        aws_account=account,
        purpose=purpose,
    )


def _upsert_s3_bucket(db: Session, account: AwsAccount, s3, name: str) -> None:
    arn = f"arn:aws:s3:::{name}"
    try:
        log_cfg = s3.get_bucket_logging(Bucket=name).get("LoggingEnabled")
        logging_enabled = log_cfg is not None
    except ClientError:
        logging_enabled = False
    try:
        enc = s3.get_bucket_encryption(Bucket=name)
        rules = enc["ServerSideEncryptionConfiguration"]["Rules"]
        sse_algo = rules[0]["ApplyServerSideEncryptionByDefault"]["SSEAlgorithm"]
        kms_encrypted = sse_algo == "aws:kms"
        encrypted = True
    except ClientError:
        kms_encrypted = False
        encrypted = False
    try:
        ver = s3.get_bucket_versioning(Bucket=name)
        versioning_enabled = ver.get("Status") == "Enabled"
        mfa_delete_enabled = ver.get("MFADelete") == "Enabled"
    except ClientError:
        versioning_enabled = False
        mfa_delete_enabled = False
    try:
        pab = s3.get_public_access_block(Bucket=name)["PublicAccessBlockConfiguration"]
        public_access_blocked = all(
            [
                pab.get("BlockPublicAcls", False),
                pab.get("IgnorePublicAcls", False),
                pab.get("BlockPublicPolicy", False),
                pab.get("RestrictPublicBuckets", False),
            ]
        )
    except ClientError:
        public_access_blocked = False
    try:
        policy_str = s3.get_bucket_policy(Bucket=name).get("Policy", "")
        https_only = "aws:SecureTransport" in policy_str
    except ClientError:
        https_only = False

    stmt = pg_insert(S3Bucket).values(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{arn}"),
        account_id=account.id,
        name=name,
        arn=arn,
        logging_enabled=logging_enabled,
        encrypted=encrypted,
        kms_encrypted=kms_encrypted,
        versioning_enabled=versioning_enabled,
        public_access_blocked=public_access_blocked,
        https_only=https_only,
        mfa_delete_enabled=mfa_delete_enabled,
        last_seen=now(),
    ).on_conflict_do_update(
        index_elements=["account_id", "arn"],
        set_={
            "logging_enabled": logging_enabled,
            "encrypted": encrypted,
            "kms_encrypted": kms_encrypted,
            "versioning_enabled": versioning_enabled,
            "public_access_blocked": public_access_blocked,
            "https_only": https_only,
            "mfa_delete_enabled": mfa_delete_enabled,
            "last_seen": now(),
        },
    )
    db.execute(stmt)


def _refresh_s3_bucket(db: Session, account: AwsAccount, finding: Finding) -> bool:
    name = s3_bucket_name(finding)
    if not name:
        return False
    s3 = _session(account, "fast_recheck_s3").client("s3", region_name="us-east-1")
    try:
        _upsert_s3_bucket(db, account, s3, name)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "NoSuchBucket":
            return True
        raise
    return True


def _refresh_security_group(db: Session, account: AwsAccount, finding: Finding) -> bool:
    group_id = evidence_str(finding, "group_id") or arn_resource_id(finding, marker="/security-group/")
    if not group_id:
        return False
    region = resource_region(finding)
    ec2 = _session(account, "fast_recheck_sg").client("ec2", region_name=region)
    try:
        sg = ec2.describe_security_groups(GroupIds=[group_id])["SecurityGroups"][0]
    except ClientError:
        return True
    ingress = sg.get("IpPermissions", [])
    egress = sg.get("IpPermissionsEgress", [])
    exposure = build_public_exposure(ingress)
    group_name = sg.get("GroupName", "")
    stmt = pg_insert(SecurityGroup).values(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{region}:{group_id}"),
        account_id=account.id,
        group_id=group_id,
        group_name=group_name,
        region=region,
        vpc_id=sg.get("VpcId"),
        is_default=group_name == "default",
        unrestricted_ssh=has_public_port(ingress, 22),
        unrestricted_rdp=has_public_port(ingress, 3389),
        public_exposure=exposure,
        has_any_inbound_rules=len(ingress) > 0,
        has_any_outbound_rules=len(egress) > 0,
        last_seen=now(),
    ).on_conflict_do_update(
        index_elements=["account_id", "group_id", "region"],
        set_={
            "unrestricted_ssh": has_public_port(ingress, 22),
            "unrestricted_rdp": has_public_port(ingress, 3389),
            "public_exposure": exposure,
            "has_any_inbound_rules": len(ingress) > 0,
            "has_any_outbound_rules": len(egress) > 0,
            "last_seen": now(),
        },
    )
    db.execute(stmt)
    return True


def _refresh_ec2_instance(db: Session, account: AwsAccount, finding: Finding) -> bool:
    instance_id = evidence_str(finding, "instance_id") or arn_resource_id(finding, marker="/instance/")
    if not instance_id:
        return False
    region = resource_region(finding)
    ec2 = _session(account, "fast_recheck_ec2").client("ec2", region_name=region)
    try:
        res = ec2.describe_instances(InstanceIds=[instance_id])["Reservations"][0]["Instances"][0]
    except (ClientError, IndexError, KeyError):
        return True
    metadata_options = res.get("MetadataOptions", {})
    stmt = pg_insert(Ec2Instance).values(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{region}:{instance_id}"),
        account_id=account.id,
        instance_id=instance_id,
        region=region,
        instance_type=res.get("InstanceType"),
        state=res.get("State", {}).get("Name", "unknown"),
        imdsv2_required=metadata_options.get("HttpTokens") == "required",
        vpc_id=res.get("VpcId"),
        subnet_id=res.get("SubnetId"),
        security_group_ids=[sg["GroupId"] for sg in res.get("SecurityGroups", [])],
        tags={t["Key"]: t["Value"] for t in res.get("Tags", [])},
        last_seen=now(),
    ).on_conflict_do_update(
        index_elements=["account_id", "region", "instance_id"],
        set_={
            "imdsv2_required": metadata_options.get("HttpTokens") == "required",
            "last_seen": now(),
        },
    )
    db.execute(stmt)
    return True


def _refresh_ebs_volume(db: Session, account: AwsAccount, finding: Finding) -> bool:
    volume_id = evidence_str(finding, "volume_id") or arn_resource_id(finding, marker="/volume/")
    if not volume_id:
        return False
    region = resource_region(finding)
    ec2 = _session(account, "fast_recheck_ebs").client("ec2", region_name=region)
    try:
        volume = ec2.describe_volumes(VolumeIds=[volume_id])["Volumes"][0]
    except (ClientError, IndexError, KeyError):
        return True
    arn = f"arn:aws:ec2:{region}:{account.account_id or 'unknown'}:volume/{volume_id}"
    stmt = pg_insert(EbsVolume).values(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{region}:{volume_id}"),
        account_id=account.id,
        region=region,
        volume_id=volume_id,
        arn=arn,
        encrypted=volume.get("Encrypted", False),
        state=volume.get("State", "unknown"),
        size_gib=volume.get("Size"),
        volume_type=volume.get("VolumeType"),
        attached_instance_ids=[
            a.get("InstanceId") for a in volume.get("Attachments", []) if a.get("InstanceId")
        ],
        last_seen=now(),
    ).on_conflict_do_update(
        index_elements=["account_id", "region", "volume_id"],
        set_={"encrypted": volume.get("Encrypted", False), "last_seen": now()},
    )
    db.execute(stmt)
    return True


def _refresh_ebs_snapshot(db: Session, account: AwsAccount, finding: Finding) -> bool:
    snapshot_id = evidence_str(finding, "snapshot_id") or arn_resource_id(finding, marker="/snapshot/")
    if not snapshot_id:
        return False
    region = resource_region(finding)
    ec2 = _session(account, "fast_recheck_ebs").client("ec2", region_name=region)
    try:
        snap = ec2.describe_snapshots(SnapshotIds=[snapshot_id])["Snapshots"][0]
    except (ClientError, IndexError, KeyError):
        return True
    arn = f"arn:aws:ec2:{region}:{account.account_id or 'unknown'}:snapshot/{snapshot_id}"
    stmt = pg_insert(EbsSnapshot).values(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{region}:{snapshot_id}"),
        account_id=account.id,
        region=region,
        snapshot_id=snapshot_id,
        arn=arn,
        encrypted=snap.get("Encrypted", False),
        is_public=snap.get("Public", False),
        last_seen=now(),
    ).on_conflict_do_update(
        index_elements=["account_id", "region", "snapshot_id"],
        set_={
            "encrypted": snap.get("Encrypted", False),
            "is_public": snap.get("Public", False),
            "last_seen": now(),
        },
    )
    db.execute(stmt)
    return True


def _refresh_ebs_encryption_default(db: Session, account: AwsAccount, finding: Finding) -> bool:
    region = resource_region(finding)
    ec2 = _session(account, "fast_recheck_ebs").client("ec2", region_name=region)
    try:
        enabled = ec2.get_ebs_encryption_by_default().get("EbsEncryptionByDefault", False)
    except ClientError:
        enabled = False
    stmt = pg_insert(EbsEncryptionDefault).values(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:ebs_default:{region}"),
        account_id=account.id,
        region=region,
        enabled=enabled,
        last_seen=now(),
    ).on_conflict_do_update(
        index_elements=["account_id", "region"],
        set_={"enabled": enabled, "last_seen": now()},
    )
    db.execute(stmt)
    return True


def _refresh_vpc(db: Session, account: AwsAccount, finding: Finding) -> bool:
    vpc_id = evidence_str(finding, "vpc_id") or arn_resource_id(finding, marker="/vpc/")
    if not vpc_id:
        return False
    region = resource_region(finding)
    ec2 = _session(account, "fast_recheck_vpc").client("ec2", region_name=region)
    flow_log_vpc_ids: set[str] = set()
    try:
        for fl in ec2.describe_flow_logs(Filters=[{"Name": "resource-type", "Values": ["VPC"]}]).get(
            "FlowLogs", []
        ):
            if fl.get("FlowLogStatus") == "ACTIVE":
                flow_log_vpc_ids.add(fl.get("ResourceId", ""))
    except ClientError:
        pass
    stmt = pg_insert(Vpc).values(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{region}:{vpc_id}"),
        account_id=account.id,
        vpc_id=vpc_id,
        region=region,
        flow_logs_enabled=vpc_id in flow_log_vpc_ids,
        last_seen=now(),
    ).on_conflict_do_update(
        index_elements=["account_id", "vpc_id", "region"],
        set_={"flow_logs_enabled": vpc_id in flow_log_vpc_ids, "last_seen": now()},
    )
    db.execute(stmt)
    return True


def _refresh_rds_instance(db: Session, account: AwsAccount, finding: Finding) -> bool:
    db_id = evidence_str(finding, "db_instance_id", "db_instance_identifier")
    arn = finding.resource_arn or ""
    region = resource_region(finding)
    rds = _session(account, "fast_recheck_rds").client("rds", region_name=region)
    try:
        if db_id:
            inst = rds.describe_db_instances(DBInstanceIdentifier=db_id)["DBInstances"][0]
        elif arn:
            inst = rds.describe_db_instances(DBInstanceIdentifier=arn.split(":")[-1])["DBInstances"][0]
        else:
            return False
    except (ClientError, IndexError, KeyError):
        return True
    arn = inst["DBInstanceArn"]
    stmt = pg_insert(RdsInstance).values(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{arn}"),
        account_id=account.id,
        db_instance_id=inst["DBInstanceIdentifier"],
        arn=arn,
        region=region,
        publicly_accessible=inst.get("PubliclyAccessible", False),
        storage_encrypted=inst.get("StorageEncrypted", False),
        backup_retention_period=inst.get("BackupRetentionPeriod", 0),
        engine=inst.get("Engine"),
        multi_az=inst.get("MultiAZ", False),
        deletion_protection=inst.get("DeletionProtection", False),
        last_seen=now(),
    ).on_conflict_do_update(
        index_elements=["account_id", "arn"],
        set_={
            "publicly_accessible": inst.get("PubliclyAccessible", False),
            "storage_encrypted": inst.get("StorageEncrypted", False),
            "backup_retention_period": inst.get("BackupRetentionPeriod", 0),
            "multi_az": inst.get("MultiAZ", False),
            "deletion_protection": inst.get("DeletionProtection", False),
            "last_seen": now(),
        },
    )
    db.execute(stmt)
    return True


def _refresh_ssm_parameter(db: Session, account: AwsAccount, finding: Finding) -> bool:
    name = evidence_str(finding, "parameter_name")
    if not name and ":parameter/" in (finding.resource_arn or ""):
        name = "/" + (finding.resource_arn or "").split(":parameter/", 1)[-1]
    if not name:
        return False
    region = resource_region(finding)
    ssm = _session(account, "fast_recheck_ssm").client("ssm", region_name=region)
    try:
        param = ssm.get_parameter(Name=name, WithDecryption=False)["Parameter"]
    except ClientError:
        return True
    stmt = pg_insert(SsmParameter).values(
        id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{region}:{name}"),
        account_id=account.id,
        region=region,
        parameter_name=name,
        parameter_type=param.get("Type", "String"),
        last_seen=now(),
    ).on_conflict_do_update(
        index_elements=["account_id", "region", "parameter_name"],
        set_={"parameter_type": param.get("Type", "String"), "last_seen": now()},
    )
    db.execute(stmt)
    return True


def _refresh_iam_access_key(db: Session, account: AwsAccount, finding: Finding) -> bool:
    evidence = finding.evidence or {}
    user_arn = evidence.get("user_arn")
    key_id = evidence.get("key_id")
    raw = finding.resource_arn or ""
    if not user_arn and "#" in raw:
        user_arn, key_id = raw.split("#", 1)
    user_name = user_arn.split("/")[-1] if user_arn and "/" in user_arn else None
    if not user_name or not key_id:
        return False
    iam = _session(account, "fast_recheck_iam_key").client("iam")
    try:
        keys = iam.list_access_keys(UserName=user_name).get("AccessKeyMetadata", [])
    except ClientError:
        return True
    match = next((k for k in keys if k.get("AccessKeyId") == key_id), None)
    if not match:
        return True
    from app.collectors.iam import _upsert_key

    last_used = iam.get_access_key_last_used(AccessKeyId=key_id).get("AccessKeyLastUsed", {})
    _upsert_key(
        db,
        account.id,
        user_arn=user_arn,
        key_id=key_id,
        status=match.get("Status"),
        created=match.get("CreateDate"),
        last_used=last_used.get("LastUsedDate"),
        last_used_service=last_used.get("ServiceName"),
        last_used_region=last_used.get("Region"),
    )
    return True


def _refresh_iam_user(db: Session, account: AwsAccount, finding: Finding) -> bool:
    user_name = evidence_str(finding, "user_name")
    arn = finding.resource_arn or ""
    if not user_name and "/user/" in arn:
        user_name = arn.split("/user/", 1)[-1]
    if not user_name:
        return False
    from app.collectors.iam import _has_console_password, _has_mfa, _upsert_user, _user_policies

    iam = _session(account, "fast_recheck_iam_user").client("iam")
    try:
        u = iam.get_user(UserName=user_name)["User"]
    except ClientError:
        return True
    attached, inline = _user_policies(iam, user_name)
    _upsert_user(
        db,
        account.id,
        arn=u["Arn"],
        name=u["UserName"],
        created=u.get("CreateDate"),
        password_last_used=u.get("PasswordLastUsed"),
        has_console_password=_has_console_password(iam, user_name),
        mfa_enabled=_has_mfa(iam, user_name),
        attached_policies=attached,
        inline_policies=inline,
    )
    return True


def _refresh_iam_role(db: Session, account: AwsAccount, finding: Finding) -> bool:
    role_name = evidence_str(finding, "role_name")
    if not role_name:
        role_arn = evidence_str(finding, "role_arn") or finding.resource_arn or ""
        role_name = parse_role_name(role_arn)
    if not role_name:
        return False
    from app.collectors.iam import _upsert_role

    iam = _session(account, "fast_recheck_iam_role").client("iam")
    try:
        r = iam.get_role(RoleName=role_name)["Role"]
    except ClientError:
        return True
    inline_policies: dict = {}
    for pname in iam.list_role_policies(RoleName=role_name).get("PolicyNames", []):
        try:
            inline_policies[pname] = iam.get_role_policy(RoleName=role_name, PolicyName=pname)["PolicyDocument"]
        except ClientError:
            pass
    attached_policies: list = []
    for pol in iam.list_attached_role_policies(RoleName=role_name).get("AttachedPolicies", []):
        pol_arn = pol["PolicyArn"]
        statements: list = []
        try:
            version_id = iam.get_policy(PolicyArn=pol_arn)["Policy"]["DefaultVersionId"]
            doc = iam.get_policy_version(PolicyArn=pol_arn, VersionId=version_id)
            raw = doc["PolicyVersion"]["Document"].get("Statement", [])
            statements = raw if isinstance(raw, list) else [raw]
        except ClientError:
            pass
        attached_policies.append(
            {
                "policy_arn": pol_arn,
                "policy_name": pol["PolicyName"],
                "policy_type": "aws_managed" if pol_arn.startswith("arn:aws:iam::aws:") else "customer_managed",
                "statements": statements,
            }
        )
    _upsert_role(
        db,
        account.id,
        arn=r["Arn"],
        name=r["RoleName"],
        created=r.get("CreateDate"),
        last_assumed=r.get("RoleLastUsed", {}).get("LastUsedDate"),
        trust_policy=r["AssumeRolePolicyDocument"],
        inline_policies=inline_policies,
        attached_policies=attached_policies,
    )
    return True


def _mini_collect(db: Session, account: AwsAccount, fn) -> bool:
    fn(db, account)
    return True


def refresh_resource_for_finding(db: Session, account: AwsAccount, finding: Finding) -> bool:
    """Update DB state for the finding's resource. Returns False if unsupported."""
    check_id = finding.check_id
    for prefix in UNSUPPORTED_PREFIXES:
        if check_id.startswith(prefix):
            return False
    if check_id in UNSUPPORTED_CHECKS:
        return False

    if check_id.startswith("s3.bucket."):
        return _refresh_s3_bucket(db, account, finding)
    if check_id.startswith("s3.account."):
        return _mini_collect(db, account, collect_s3_account_public_access_block)

    if check_id.startswith("ec2.security_group."):
        return _refresh_security_group(db, account, finding)
    if check_id.startswith("ec2.instance."):
        return _refresh_ec2_instance(db, account, finding)
    if check_id == "ec2.ebs.encryption_not_default":
        return _refresh_ebs_encryption_default(db, account, finding)
    if check_id.startswith("ec2.ebs.snapshot"):
        return _refresh_ebs_snapshot(db, account, finding)
    if check_id.startswith("ec2.ebs."):
        return _refresh_ebs_volume(db, account, finding)
    if check_id.startswith("ec2.ami."):
        from app.collectors.ec2 import collect_ec2

        return _mini_collect(db, account, collect_ec2)

    if check_id.startswith("vpc."):
        return _refresh_vpc(db, account, finding)
    if check_id.startswith("rds.instance."):
        return _refresh_rds_instance(db, account, finding)
    if check_id.startswith("ssm.parameter."):
        return _refresh_ssm_parameter(db, account, finding)

    if check_id.startswith("iam.access_key."):
        return _refresh_iam_access_key(db, account, finding)
    if check_id.startswith("iam.user."):
        return _refresh_iam_user(db, account, finding)
    if check_id.startswith("iam.role.") or check_id.startswith("iam.policy."):
        if check_id.startswith("iam.role."):
            return _refresh_iam_role(db, account, finding)
        return _mini_collect(db, account, collect_iam)
    if check_id.startswith("iam.root.") or check_id.startswith("iam.account."):
        return _mini_collect(db, account, collect_iam)
    if check_id.startswith("iam.server_certificate."):
        return _mini_collect(db, account, collect_iam_server_certificates)

    if check_id.startswith("kms."):
        from app.collectors.account import collect_kms

        key_id = evidence_str(finding, "key_id") or arn_resource_id(finding, marker="/key/")
        if key_id:
            sess = _session(account, "fast_recheck_kms")
            kms = sess.client("kms", region_name=resource_region(finding))
            try:
                meta = kms.describe_key(KeyId=key_id)["KeyMetadata"]
                arn = meta["Arn"]
                rotation = False
                try:
                    rotation = kms.get_key_rotation_status(KeyId=key_id).get("KeyRotationEnabled", False)
                except ClientError:
                    pass
                stmt = pg_insert(KmsKey).values(
                    id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{arn}"),
                    account_id=account.id,
                    key_id=meta["KeyId"],
                    arn=arn,
                    rotation_enabled=rotation,
                    key_state=meta.get("KeyState"),
                    last_seen=now(),
                ).on_conflict_do_update(
                    index_elements=["account_id", "arn"],
                    set_={"rotation_enabled": rotation, "key_state": meta.get("KeyState"), "last_seen": now()},
                )
                db.execute(stmt)
                return True
            except ClientError:
                return True
        return _mini_collect(db, account, collect_kms)

    if check_id.startswith("cloudtrail.trail."):
        from app.collectors.cloudtrail import collect_cloudtrail

        return _mini_collect(db, account, collect_cloudtrail)
    if check_id.startswith("guardduty."):
        return _mini_collect(db, account, collect_guardduty)
    if check_id.startswith("aws.config."):
        from app.collectors.config_compliance import collect_config_compliance

        if check_id == "aws.config.rules_non_compliant":
            return _mini_collect(db, account, collect_config_compliance)
        return _mini_collect(db, account, collect_config_service)
    if check_id.startswith("aws.securityhub."):
        return _mini_collect(db, account, collect_securityhub)
    if check_id.startswith("aws.access_analyzer."):
        return _mini_collect(db, account, collect_access_analyzer)
    if check_id.startswith("aws.account."):
        return _mini_collect(db, account, collect_account_governance)

    if check_id.startswith("lambda."):
        fn_name = evidence_str(finding, "function_name")
        arn = finding.resource_arn or ""
        if not fn_name and ":function:" in arn:
            fn_name = arn.split(":function:", 1)[-1]
        if fn_name:
            region = resource_region(finding)
            lam = _session(account, "fast_recheck_lambda").client("lambda", region_name=region)
            try:
                fn = lam.get_function(FunctionName=fn_name)["Configuration"]
                has_dlq = False
                try:
                    cfg = lam.get_function_event_invoke_config(FunctionName=fn_name)
                    has_dlq = bool(cfg.get("DestinationConfig", {}).get("OnFailure", {}).get("Destination"))
                except ClientError:
                    pass
                full_arn = fn["FunctionArn"]
                stmt = pg_insert(LambdaFunction).values(
                    id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{full_arn}"),
                    account_id=account.id,
                    region=region,
                    function_name=fn_name,
                    arn=full_arn,
                    runtime=fn.get("Runtime"),
                    has_dlq=has_dlq,
                    last_seen=now(),
                ).on_conflict_do_update(
                    index_elements=["account_id", "arn"],
                    set_={"runtime": fn.get("Runtime"), "has_dlq": has_dlq, "last_seen": now()},
                )
                db.execute(stmt)
                return True
            except ClientError:
                return True
        from app.collectors.extended import collect_lambda

        return _mini_collect(db, account, collect_lambda)
    if check_id.startswith("acm."):
        from app.collectors.extended import collect_acm

        return _mini_collect(db, account, collect_acm)
    if check_id.startswith("secretsmanager."):
        from app.collectors.extended import collect_secrets

        return _mini_collect(db, account, collect_secrets)
    if check_id.startswith("elb."):
        from app.collectors.extended import collect_elb

        return _mini_collect(db, account, collect_elb)
    if check_id.startswith("dynamodb."):
        from app.collectors.extended import collect_dynamodb

        return _mini_collect(db, account, collect_dynamodb)
    if check_id.startswith("sns."):
        from app.collectors.extended import collect_sns

        return _mini_collect(db, account, collect_sns)
    if check_id.startswith("sqs."):
        from app.collectors.extended import collect_sqs

        return _mini_collect(db, account, collect_sqs)

    if check_id.startswith("aws.identity") or check_id.startswith("identity_center.user."):
        from app.collectors.identity_center import collect_identity_center

        return _mini_collect(db, account, collect_identity_center)

    return False
