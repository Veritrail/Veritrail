"""AWS-owned SSM Automation runbook candidates (discovery / UI metadata).

Execution still uses ``ssm_remediation_catalog`` until dispatch is migrated.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

Confidence = Literal["high", "medium", "low"]
Preferred = Literal["true", "conditional"]


@dataclass(frozen=True)
class AwsOwnedRunbookCandidate:
    check_id: str
    document_name: str
    preferred: Preferred
    confidence: Confidence
    required_inputs: tuple[str, ...]
    note: str = ""


AWS_OWNED_RUNBOOKS: dict[str, AwsOwnedRunbookCandidate] = {
    "s3.bucket.public_access_not_blocked": AwsOwnedRunbookCandidate(
        check_id="s3.bucket.public_access_not_blocked",
        document_name="AWSConfigRemediation-ConfigureS3BucketPublicAccessBlock",
        preferred="true",
        confidence="high",
        required_inputs=("bucket_name",),
        note="AWS Config remediation runbook blocks public access on the named bucket.",
    ),
    "cloudtrail.trail.not_enabled": AwsOwnedRunbookCandidate(
        check_id="cloudtrail.trail.not_enabled",
        document_name="AWS-EnableCloudTrail",
        preferred="conditional",
        confidence="medium",
        required_inputs=("trail_name", "bucket_name"),
        note="Use only when trail and log bucket names are known from finding evidence.",
    ),
    "ec2.security_group.default_allows_traffic": AwsOwnedRunbookCandidate(
        check_id="ec2.security_group.default_allows_traffic",
        document_name="AWS-DisablePublicAccessForSecurityGroup",
        preferred="conditional",
        confidence="medium",
        required_inputs=("group_id",),
        note=(
            "For default SG public access only — not for arbitrary SSH/RDP "
            "exact-match findings unless exact rule targeting is verified."
        ),
    ),
}


def get_aws_owned_runbook(check_id: str) -> AwsOwnedRunbookCandidate | None:
    return AWS_OWNED_RUNBOOKS.get(check_id)


def _evidence_has_keys(evidence: dict[str, Any] | None, keys: tuple[str, ...]) -> bool:
    if not evidence:
        return False
    for key in keys:
        if evidence.get(key):
            return True
        alt = "".join(part.capitalize() for part in key.split("_"))
        if evidence.get(alt):
            return True
    return False


def _cloudtrail_context_ready(evidence: dict[str, Any] | None) -> bool:
    if not evidence:
        return False
    trail_keys = ("trail_name", "TrailName", "name")
    bucket_keys = ("bucket_name", "s3_bucket_name", "S3BucketName", "log_bucket_name")
    has_trail = any(evidence.get(k) for k in trail_keys)
    has_bucket = any(evidence.get(k) for k in bucket_keys)
    return has_trail and has_bucket


def _security_group_context_ready(evidence: dict[str, Any] | None) -> bool:
    if not evidence:
        return False
    if evidence.get("group_id") or evidence.get("GroupId"):
        return True
    arn = evidence.get("resource_arn") or evidence.get("group_arn") or ""
    return "/security-group/" in str(arn)


def is_aws_owned_preferred(
    check_id: str,
    *,
    evidence: dict[str, Any] | None = None,
) -> bool:
    """Whether UI should treat the AWS-owned candidate as the preferred runbook."""
    candidate = get_aws_owned_runbook(check_id)
    if candidate is None:
        return False
    if candidate.preferred == "true":
        return True
    if candidate.preferred != "conditional":
        return False
    if check_id == "cloudtrail.trail.not_enabled":
        return _cloudtrail_context_ready(evidence)
    if check_id == "ec2.security_group.default_allows_traffic":
        return _security_group_context_ready(evidence)
    return _evidence_has_keys(evidence, candidate.required_inputs)


def aws_runbook_docs_url(document_name: str) -> str:
    slug = document_name.lower().replace("_", "-")
    return (
        "https://docs.aws.amazon.com/systems-manager-automation-runbooks/latest/userguide/"
        f"automation-{slug}.html"
    )


def remediation_automation_metadata(
    check_id: str,
    *,
    evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Discovery metadata for the finding drawer / SSM UI (no execution side effects)."""
    candidate = get_aws_owned_runbook(check_id)
    if candidate and is_aws_owned_preferred(check_id, evidence=evidence):
        return {
            "automation_provider": "aws-owned",
            "aws_document_name": candidate.document_name,
            "automation_confidence": candidate.confidence,
            "automation_note": candidate.note,
            "aws_runbook_docs_url": aws_runbook_docs_url(candidate.document_name),
        }
    note = ""
    if candidate:
        note = candidate.note
    return {
        "automation_provider": "vigil",
        "aws_document_name": None,
        "automation_confidence": None,
        "automation_note": note,
        "aws_runbook_docs_url": None,
    }
