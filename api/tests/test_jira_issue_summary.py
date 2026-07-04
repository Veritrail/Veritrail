"""Jira issue summary builder."""
from __future__ import annotations

from app.services.jira_issue_summary import build_jira_issue_summary


def test_jira_summary_iam_role_least_privilege_deduplicates_name():
    summary = build_jira_issue_summary(
        check_id="iam.role.least_privilege_policy",
        resource_arn="arn:aws:iam::123456789012:role/CCLabAdminRole",
        title="Role `CCLabAdminRole` — least privilege violation (Action:* and Resource:*)",
    )
    assert summary == (
        "[Veritrail] IAM Role CCLabAdminRole — least privilege violation (Action:* and Resource:*)"
    )


def test_jira_summary_iam_role_unassumed_keeps_detail():
    summary = build_jira_issue_summary(
        check_id="iam.role.unassumed_90d",
        resource_arn="arn:aws:iam::123456789012:role/StagingDeployRole",
        title="Role `StagingDeployRole` has not been assumed for 90+ days",
    )
    assert summary == "[Veritrail] IAM Role StagingDeployRole — has not been assumed for 90+ days"


def test_jira_summary_s3_bucket():
    summary = build_jira_issue_summary(
        check_id="s3.bucket.no_logging",
        resource_arn="arn:aws:s3:::my-audit-bucket",
        title="S3 bucket `my-audit-bucket` has access logging disabled",
    )
    assert summary == "[Veritrail] S3 Bucket my-audit-bucket — has access logging disabled"


def test_jira_summary_when_title_already_includes_name():
    summary = build_jira_issue_summary(
        check_id="gcp.asset.public_iam_binding",
        resource_arn="//compute.googleapis.com/projects/demo/zones/us-central1-a/instances/web-1",
        title="GCP asset web-1 has a public IAM binding",
    )
    assert summary == "[Veritrail] GCP asset web-1 has a public IAM binding"


def test_jira_summary_fallback_prefixes_short_name():
    summary = build_jira_issue_summary(
        check_id="cloudtrail.event.root_activity",
        resource_arn="arn:aws:iam::123456789012:root",
        title="Root user called DeleteTrail — review immediately",
    )
    assert summary == "[Veritrail] root — Root user called DeleteTrail — review immediately"
