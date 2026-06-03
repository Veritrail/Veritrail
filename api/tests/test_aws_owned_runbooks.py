from app.data.aws_owned_runbooks import (
    get_aws_owned_runbook,
    is_aws_owned_preferred,
    remediation_automation_metadata,
)


def test_s3_aws_owned_preferred():
    assert is_aws_owned_preferred("s3.bucket.public_access_not_blocked")
    meta = remediation_automation_metadata("s3.bucket.public_access_not_blocked")
    assert meta["automation_provider"] == "aws-owned"
    assert meta["aws_document_name"] == "AWSConfigRemediation-ConfigureS3BucketPublicAccessBlock"
    assert meta["automation_confidence"] == "high"


def test_sg_ssh_stays_vigil_metadata():
    meta = remediation_automation_metadata("ec2.security_group.unrestricted_ssh")
    assert meta["automation_provider"] == "vigil"
    assert meta["aws_document_name"] is None
    assert not is_aws_owned_preferred("ec2.security_group.unrestricted_ssh")


def test_iam_key_stays_vigil_metadata():
    meta = remediation_automation_metadata("iam.access_key.unused_90d")
    assert meta["automation_provider"] == "vigil"
    assert meta["aws_document_name"] is None


def test_cloudtrail_conditional_without_evidence():
    assert not is_aws_owned_preferred("cloudtrail.trail.not_enabled")
    meta = remediation_automation_metadata("cloudtrail.trail.not_enabled")
    assert meta["automation_provider"] == "vigil"


def test_cloudtrail_preferred_with_trail_and_bucket():
    ev = {"trail_name": "org-trail", "bucket_name": "logs-bucket"}
    assert is_aws_owned_preferred("cloudtrail.trail.not_enabled", evidence=ev)
    meta = remediation_automation_metadata("cloudtrail.trail.not_enabled", evidence=ev)
    assert meta["automation_provider"] == "aws-owned"
    assert meta["aws_document_name"] == "AWS-EnableCloudTrail"


def test_default_sg_conditional_with_group_id():
    rb = get_aws_owned_runbook("ec2.security_group.default_allows_traffic")
    assert rb is not None
    assert rb.document_name == "AWS-DisablePublicAccessForSecurityGroup"
    assert is_aws_owned_preferred(
        "ec2.security_group.default_allows_traffic",
        evidence={"group_id": "sg-abc"},
    )
