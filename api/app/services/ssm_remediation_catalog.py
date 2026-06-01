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


VIGIL_PLAN_DOCUMENT = "Vigil-RemediationPlanExecutor"  # legacy fallback
VIGIL_SG_DOCUMENT = "Vigil-RevokeSecurityGroupIngressExact"
VIGIL_IAM_KEY_DOCUMENT = "Vigil-DeactivateIamAccessKey"
VIGIL_SSM_PARAMETER_DOCUMENT = "Vigil-MigrateSsmParameterToSecureString"

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
        document_name="AWSConfigRemediation-ConfigureS3PublicAccessBlock",
        owner="aws",
        parameter_mode="aws_s3_public_access_block",
        note="AWS-owned runbook enables all four S3 Block Public Access settings on the reviewed bucket.",
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
    "cloudtrail.trail.not_enabled": SsmRemediationRunbook(
        check_id="cloudtrail.trail.not_enabled",
        document_name="AWS-EnableCloudTrail",
        owner="aws",
        parameter_mode="aws_cloudtrail_manual",
        note="AWS-owned runbook exists, but requires trail and log-bucket inputs. Vigil does not auto-run it yet.",
    ),
}


def runbook_for_check(check_id: str) -> SsmRemediationRunbook | None:
    return RUNBOOKS.get(check_id)


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


def _require_automation_role(automation_assume_role_arn: str | None) -> str:
    if not automation_assume_role_arn:
        raise ValueError("missing AutomationAssumeRole ARN for AWS-owned runbook")
    return automation_assume_role_arn


def automation_parameters_for_plan(
    plan_json: str,
    runbook: SsmRemediationRunbook,
    *,
    automation_assume_role_arn: str | None = None,
) -> dict[str, list[str]]:
    if runbook.parameter_mode == "plan_json":
        return {"PlanJson": [plan_json]}

    plan = _load_plan(plan_json)
    if runbook.parameter_mode == "aws_s3_public_access_block":
        return {
            "AutomationAssumeRole": [_require_automation_role(automation_assume_role_arn)],
            "BucketName": [_bucket_name(plan)],
            "BlockPublicAcls": ["true"],
            "BlockPublicPolicy": ["true"],
            "IgnorePublicAcls": ["true"],
            "RestrictPublicBuckets": ["true"],
        }

    if runbook.parameter_mode == "aws_cloudtrail_manual":
        raise ValueError("AWS-EnableCloudTrail requires S3BucketName and TrailName; Vigil does not auto-run it yet")

    raise ValueError(f"unsupported SSM runbook parameter mode: {runbook.parameter_mode}")


def runbook_payload(runbook: SsmRemediationRunbook) -> dict[str, Any]:
    return {
        "check_id": runbook.check_id,
        "document_name": runbook.document_name,
        "owner": runbook.owner,
        "parameter_mode": runbook.parameter_mode,
        "note": runbook.note,
    }
