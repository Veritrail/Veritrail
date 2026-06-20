"""SSM Automation mapping for approved remediation.

Prefer AWS-owned runbooks where they fit the finding safely. Use focused Vigil
custom runbooks where AWS has no exact runbook or where the AWS runbook is
broader than Vigil's reviewed evidence.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SsmRemediationRunbook:
    check_id: str
    document_name: str
    owner: str
    parameter_mode: str
    note: str


VIGIL_SG_DOCUMENT = "Vigil-RevokeSecurityGroupIngressExact"
VIGIL_IAM_KEY_DOCUMENT = "Vigil-DeactivateIamAccessKey"
VIGIL_SSM_PARAMETER_DOCUMENT = "Vigil-MigrateSsmParameterToSecureString"
VIGIL_IAM_POLICY_DOCUMENT = "Vigil-RemediateIamExcessPermissions"

AWS_S3_BUCKET_PAB_DOCUMENT = "AWSConfigRemediation-ConfigureS3BucketPublicAccessBlock"
AWS_KMS_ENABLE_ROTATION_DOCUMENT = "AWSConfigRemediation-EnableKeyRotation"

RUNBOOKS: dict[str, SsmRemediationRunbook] = {
    "ec2.security_group.unrestricted_ssh": SsmRemediationRunbook(
        check_id="ec2.security_group.unrestricted_ssh",
        document_name=VIGIL_SG_DOCUMENT,
        owner="vigil",
        parameter_mode="plan_json",
        note="Focused Vigil runbook removes only the exact public ingress rule captured in finding evidence.",
    ),
    "ec2.security_group.unrestricted_rdp": SsmRemediationRunbook(
        check_id="ec2.security_group.unrestricted_rdp",
        document_name=VIGIL_SG_DOCUMENT,
        owner="vigil",
        parameter_mode="plan_json",
        note="Focused Vigil runbook removes only the exact public ingress rule captured in finding evidence.",
    ),
    "ssm.parameter.plaintext_secret": SsmRemediationRunbook(
        check_id="ssm.parameter.plaintext_secret",
        document_name=VIGIL_SSM_PARAMETER_DOCUMENT,
        owner="vigil",
        parameter_mode="plan_json",
        note="Focused Vigil runbook rewrites the reviewed String parameter as SecureString.",
    ),
    "s3.bucket.public_access_not_blocked": SsmRemediationRunbook(
        check_id="s3.bucket.public_access_not_blocked",
        document_name=AWS_S3_BUCKET_PAB_DOCUMENT,
        owner="aws",
        parameter_mode="aws_s3_bucket_pab",
        note="AWS-owned runbook enables all four Block Public Access settings on the bucket named in the approved plan.",
    ),
    "iam.access_key.unused_45d": SsmRemediationRunbook(
        check_id="iam.access_key.unused_45d",
        document_name=VIGIL_IAM_KEY_DOCUMENT,
        owner="vigil",
        parameter_mode="plan_json",
        note="Focused Vigil runbook deactivates only the reviewed access key.",
    ),
    "iam.access_key.unused_90d": SsmRemediationRunbook(
        check_id="iam.access_key.unused_90d",
        document_name=VIGIL_IAM_KEY_DOCUMENT,
        owner="vigil",
        parameter_mode="plan_json",
        note="Focused Vigil runbook deactivates only the reviewed access key.",
    ),
    "iam.role.least_privilege_policy": SsmRemediationRunbook(
        check_id="iam.role.least_privilege_policy",
        document_name=VIGIL_IAM_POLICY_DOCUMENT,
        owner="vigil",
        parameter_mode="plan_json",
        note=(
            "Applies the approved least-privilege proposal from CloudTrail + IAM last-accessed data. "
            "Requires high-confidence policy analysis before dispatch."
        ),
    ),
    "cloudtrail.trail.not_enabled": SsmRemediationRunbook(
        check_id="cloudtrail.trail.not_enabled",
        document_name="AWS-EnableCloudTrail",
        owner="aws",
        parameter_mode="aws_cloudtrail_enable_guided",
        note="AWS-owned runbook — requires user-supplied S3BucketName and TrailName. Not auto-execed without user input.",
    ),
    "kms.key.no_rotation": SsmRemediationRunbook(
        check_id="kms.key.no_rotation",
        document_name=AWS_KMS_ENABLE_ROTATION_DOCUMENT,
        owner="aws",
        parameter_mode="aws_kms_enable_rotation",
        note="AWS-owned runbook enables annual rotation on the reviewed key. Idempotent and transparent to callers.",
    ),
}


def runbook_for_check(check_id: str) -> SsmRemediationRunbook | None:
    return RUNBOOKS.get(check_id)


def ssm_document_console_url(document_name: str, region: str) -> str:
    """Deep link to the SSM Automation document in the AWS console (customer account)."""
    from urllib.parse import quote

    doc = quote(document_name, safe="")
    reg = quote(region, safe="")
    return (
        f"https://{reg}.console.aws.amazon.com/systems-manager/documents/"
        f"{doc}/description?region={reg}"
    )


def runbook_source_url(runbook: SsmRemediationRunbook, *, automation_region: str = "us-east-1") -> str:
    """AWS runbook docs (public) or SSM document console link for Vigil-owned documents."""
    if runbook.owner == "aws":
        slug = runbook.document_name.lower().replace("_", "-")
        return (
            "https://docs.aws.amazon.com/systems-manager-automation-runbooks/latest/userguide/"
            f"automation-{slug}.html"
        )
    return ssm_document_console_url(runbook.document_name, automation_region)


def _load_plan(plan_json: str) -> dict[str, Any]:
    return json.loads(plan_json)


def _bucket_name(plan: dict[str, Any]) -> str:
    evidence = plan.get("evidence") or {}
    for key in ("bucket_name", "bucket", "name"):
        if evidence.get(key):
            return str(evidence[key])

    arn = plan.get("resource_arn") or ""
    prefix = "arn:aws:s3:::"
    if arn.startswith(prefix):
        return arn[len(prefix):].split("/", 1)[0]
    if arn and ":" not in arn and "/" not in arn:
        return arn
    raise ValueError("missing S3 bucket name")


def _kms_key_id(plan: dict[str, Any]) -> str:
    """Resolve a KMS KeyId from reviewed evidence or the key ARN."""
    evidence = plan.get("evidence") or {}
    if evidence.get("key_id"):
        return str(evidence["key_id"])

    arn = plan.get("resource_arn") or ""
    # arn:aws:kms:<region>:<account>:key/<key-id>
    if ":key/" in arn:
        return arn.split(":key/", 1)[1]
    if arn and ":" not in arn:
        return arn
    raise ValueError("missing KMS key id")


def _require_automation_role(automation_assume_role_arn: str | None) -> str:
    if not automation_assume_role_arn:
        raise ValueError("missing AutomationAssumeRole ARN for AWS-owned runbook")
    return automation_assume_role_arn


def automation_parameters_for_plan(
    plan_json: str,
    runbook: SsmRemediationRunbook,
    *,
    automation_assume_role_arn: str | None = None,
    parameter_overrides: dict[str, str] | None = None,
) -> dict[str, list[str]]:
    if runbook.parameter_mode == "plan_json":
        return {"PlanJson": [plan_json]}

    plan = _load_plan(plan_json)
    if runbook.parameter_mode == "aws_s3_bucket_pab":
        automation_role = _require_automation_role(automation_assume_role_arn)
        bucket = _bucket_name(plan)
        return {
            "AutomationAssumeRole": [automation_role],
            "BucketName": [bucket],
            "BlockPublicAcls": ["true"],
            "BlockPublicPolicy": ["true"],
            "IgnorePublicAcls": ["true"],
            "RestrictPublicBuckets": ["true"],
        }

    if runbook.parameter_mode == "aws_kms_enable_rotation":
        automation_role = _require_automation_role(automation_assume_role_arn)
        return {
            "AutomationAssumeRole": [automation_role],
            "KeyId": [_kms_key_id(plan)],
        }

    if runbook.parameter_mode == "aws_cloudtrail_enable_guided":
        automation_role = _require_automation_role(automation_assume_role_arn)
        overrides = parameter_overrides or {}
        plan_params = plan.get("parameters") or {}
        trail_name = overrides.get("TrailName") or plan_params.get("TrailName", "VigilCloudTrail")
        s3_bucket = overrides.get("S3BucketName") or plan_params.get("S3BucketName", "")
        params: dict[str, list[str]] = {
            "AutomationAssumeRole": [automation_role],
            "TrailName": [trail_name],
            "S3BucketName": [s3_bucket or ""],
        }
        if plan_params.get("EnableLogFileValidation"):
            params["EnableLogFileValidation"] = ["true"]
        if plan_params.get("IncludeGlobalServiceEvents"):
            params["IncludeGlobalServiceEvents"] = ["true"]
        if plan_params.get("IsMultiRegionTrail"):
            params["IsMultiRegionTrail"] = ["true"]
        return params

    raise ValueError(f"unsupported SSM runbook parameter mode: {runbook.parameter_mode}")


def runbook_payload(runbook: SsmRemediationRunbook, *, automation_region: str = "us-east-1") -> dict[str, Any]:
    return {
        "check_id": runbook.check_id,
        "document_name": runbook.document_name,
        "owner": runbook.owner,
        "parameter_mode": runbook.parameter_mode,
        "note": runbook.note,
        "source_url": runbook_source_url(runbook, automation_region=automation_region),
    }
