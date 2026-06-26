from app.services.evidence_gap import (
    absence_gap_prompt,
    is_absence_gap_check,
    open_absence_gap_check_ids,
)


def test_is_absence_gap_check_by_suffix():
    assert is_absence_gap_check("aws.vulnerability_monitoring.not_detected") is True
    assert is_absence_gap_check("guardduty.detector.not_enabled") is True
    assert is_absence_gap_check("backup.plan.missing") is True
    assert is_absence_gap_check("s3.bucket.public_read") is False
    assert is_absence_gap_check("cloudtrail.trail.disabled") is False


def test_open_absence_gap_requires_open_finding():
    check_ids = [
        "aws.vulnerability_monitoring.not_detected",
        "inspector.finding.critical",
    ]
    open_by_check = {"inspector.finding.critical": [object()]}
    assert open_absence_gap_check_ids(check_ids, open_by_check) == []

    open_by_check["aws.vulnerability_monitoring.not_detected"] = [object()]
    assert open_absence_gap_check_ids(check_ids, open_by_check) == [
        "aws.vulnerability_monitoring.not_detected"
    ]


def test_absence_gap_prompt_two_paths():
    prompt = absence_gap_prompt("aws.vulnerability_monitoring.not_detected")
    assert prompt["capability"] == "Vulnerability management"
    assert "outside AWS" in prompt["external_option"]
    assert "Inspector" in prompt["aws_option"]

    vpc = absence_gap_prompt("vpc.flow_logs.not_enabled")
    assert "external_option" in vpc and "aws_option" in vpc
    assert "VPC flow logs" in vpc["aws_option"]
