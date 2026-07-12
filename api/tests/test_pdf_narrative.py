"""Tests for the capability-domain narrative builder behind the evidence PDF."""
from __future__ import annotations

from datetime import datetime, timezone

from app.services.pdf_narrative import (
    build_domain_sections,
    domain_for_check,
    exception_narrative,
)

NOW = datetime(2026, 7, 10, 12, 0, tzinfo=timezone.utc)


def _control(control_id, checks, findings=None, exceptions=None, status="pass"):
    return {
        "control_id": control_id,
        "title": f"{control_id} - Objective",
        "status": status,
        "finding_count": len(findings or []),
        "findings": findings or [],
        "exceptions": exceptions or [],
        "check_evidence_classes": {c: "benchmark" for c in checks},
    }


def _finding(fid, check_id, arn, *, severity="medium", status="open", exception=None):
    d = {
        "id": fid,
        "check_id": check_id,
        "resource_arn": arn,
        "title": f"Issue on {arn.rsplit('/', 1)[-1]}",
        "severity": severity,
        "status": status,
        "first_seen": "2026-05-01T00:00:00+00:00",
        "last_seen": NOW.isoformat(),
    }
    if exception:
        d["exception"] = exception
    return d


def _sections(controls, framework="soc2"):
    return build_domain_sections(
        controls,
        framework=framework,
        account_label="prod",
        account_id="123456789012",
        generated_at=NOW,
    )


def test_domain_for_check_grouping():
    assert domain_for_check("rds.instance.no_automated_backup") == "backup_dr"
    assert domain_for_check("dynamodb.table.no_pitr") == "backup_dr"
    assert domain_for_check("rds.instance.no_multi_az") is None
    assert domain_for_check("iam.user.no_mfa") == "identity_access"
    assert domain_for_check("github.repo.no_branch_protection") == "secure_sdlc"
    assert domain_for_check("cloudtrail.trail.not_enabled") == "logging_monitoring"
    assert domain_for_check("ec2.security_group.unrestricted_ssh") == "network_boundary"
    assert domain_for_check("guardduty.detector.not_enabled") == "incident_response"
    assert domain_for_check("s3.bucket.no_default_encryption") == "data_protection"


def test_all_passing_assertion_is_supported_and_scoped():
    controls = [
        _control("CC7.5", ["rds.instance.no_automated_backup", "dynamodb.table.no_pitr"]),
    ]
    (sec,) = _sections(controls)
    assert sec.key == "backup_dr"
    assert sec.checks_total == 2
    assert sec.checks_passing == 2
    assert "is supported by automated evidence" in sec.assertion
    assert "account prod (123456789012)" in sec.assertion
    assert "As of 2026-07-10 12:00 UTC" in sec.assertion
    # Verified capability phrases are drawn from check results, not overclaimed.
    assert (
        "automated backups and point-in-time restoration are enabled on RDS instances"
        in sec.assertion
    )
    assert "point-in-time recovery is enabled on DynamoDB tables" in sec.assertion


def test_assertion_never_overclaims():
    controls = [
        _control("CC6.1", ["iam.user.no_mfa"]),
        _control(
            "CC7.2",
            ["cloudtrail.trail.not_enabled"],
            findings=[_finding("f1", "cloudtrail.trail.not_enabled", "arn:aws:cloudtrail:us-east-1:1:trail/t")],
            status="fail",
        ),
    ]
    for sec in _sections(controls):
        lowered = sec.assertion.lower()
        for banned in ("fulfills", "fulfilled", "is secure", "is compliant", "guarantees"):
            assert banned not in lowered, f"{sec.key}: {banned!r} in assertion"


def test_partial_support_when_gaps_exist():
    controls = [
        _control(
            "CC7.2",
            ["cloudtrail.trail.not_enabled", "cloudtrail.trail.no_log_validation"],
            findings=[_finding("f1", "cloudtrail.trail.no_log_validation", "arn:aws:cloudtrail:us-east-1:1:trail/t")],
            status="fail",
        ),
    ]
    (sec,) = _sections(controls)
    assert sec.key == "logging_monitoring"
    assert sec.checks_total == 2
    assert sec.checks_passing == 1
    assert "is partially supported" in sec.assertion
    assert "1 open finding(s)" in sec.assertion
    assert "open findings are not treated as exceptions" in sec.assertion


def test_exception_vs_gap_split():
    exc = {"reason": "sandbox environment", "approved_by": "Alice (CTO)", "expires_at": "2026-10-01T00:00:00+00:00"}
    controls = [
        _control(
            "CC6.7",
            ["s3.bucket.no_default_encryption"],
            findings=[_finding("f-open", "s3.bucket.no_default_encryption", "arn:aws:s3:::open-bucket")],
            exceptions=[
                _finding("f-exc", "s3.bucket.no_default_encryption", "arn:aws:s3:::sandbox-bucket", status="excepted", exception=exc)
            ],
            status="fail",
        ),
    ]
    (sec,) = _sections(controls)
    assert [g["id"] for g in sec.gaps] == ["f-open"]
    assert [e["id"] for e in sec.exceptions] == ["f-exc"]
    # Exceptions carry their recorded reason into the narrative.
    line = exception_narrative(sec.exceptions[0])
    assert "sandbox environment" in line
    assert "Alice (CTO)" in line
    assert "expires 2026-10-01" in line
    # Appendix rows split dispositions and carry the reason only for exceptions.
    by_arn = {r["resource_arn"]: r for r in sec.appendix_rows}
    assert by_arn["arn:aws:s3:::open-bucket"]["disposition"] == "Open gap"
    assert by_arn["arn:aws:s3:::open-bucket"]["exception_reason"] is None
    assert by_arn["arn:aws:s3:::sandbox-bucket"]["disposition"] == "Documented exception"
    assert by_arn["arn:aws:s3:::sandbox-bucket"]["exception_reason"] == "sandbox environment"


def test_findings_deduped_across_controls():
    f = _finding("dup-1", "iam.user.no_mfa", "arn:aws:iam::1:user/bob", severity="high")
    controls = [
        _control("CC6.1", ["iam.user.no_mfa"], findings=[f], status="fail"),
        _control("CC6.2", ["iam.user.no_mfa"], findings=[dict(f)], status="fail"),
    ]
    (sec,) = _sections(controls)
    assert len(sec.gaps) == 1
    assert sec.checks_total == 1
    assert sec.checks_passing == 0
    # Both controls are cross-referenced on the section.
    assert "SOC 2 CC6.1" in sec.control_tags
    assert "SOC 2 CC6.2" in sec.control_tags


def test_coverage_line_math_and_scope():
    controls = [
        _control(
            "CC6.6",
            ["ec2.security_group.unrestricted_ssh", "ec2.security_group.unrestricted_rdp", "rds.instance.publicly_accessible"],
            findings=[
                _finding("g1", "ec2.security_group.unrestricted_ssh", "arn:aws:ec2:us-east-1:1:security-group/sg-1", severity="high"),
                _finding("g2", "ec2.security_group.unrestricted_ssh", "arn:aws:ec2:us-east-1:1:security-group/sg-2", severity="high"),
            ],
            status="fail",
        ),
    ]
    (sec,) = _sections(controls)
    assert sec.key == "network_boundary"
    assert "1 of 3 automated checks passing" not in sec.coverage_line  # 2 of 3 pass
    assert "2 of 3 automated checks passing" in sec.coverage_line
    assert "2 open finding(s) on 2 resource(s)" in sec.coverage_line
    assert "scope: account prod (123456789012)" in sec.coverage_line


def test_sdlc_domain_uses_workspace_scope():
    controls = [
        _control("CC8.1", ["github.repo.no_branch_protection", "github.repo.insufficient_reviews"]),
    ]
    (sec,) = _sections(controls)
    assert sec.key == "secure_sdlc"
    assert sec.scope_note is not None
    assert "not scoped to this cloud account" in sec.scope_note
    assert "connected source-control workspace" in sec.assertion
    assert "scope: connected source-control workspace" in sec.coverage_line


def test_domains_without_checks_are_omitted():
    controls = [_control("CC6.1", ["iam.user.no_mfa"])]
    sections = _sections(controls)
    assert [s.key for s in sections] == ["identity_access"]


def test_gaps_sorted_by_severity():
    controls = [
        _control(
            "CC6.6",
            ["ec2.security_group.unrestricted_ssh"],
            findings=[
                _finding("low", "ec2.security_group.unrestricted_ssh", "arn:aws:ec2:us-east-1:1:security-group/sg-a", severity="low"),
                _finding("crit", "ec2.security_group.unrestricted_ssh", "arn:aws:ec2:us-east-1:1:security-group/sg-b", severity="critical"),
            ],
            status="fail",
        ),
    ]
    (sec,) = _sections(controls)
    assert [g["id"] for g in sec.gaps] == ["crit", "low"]


def test_cross_framework_tags_present():
    controls = [_control("CC7.5", ["rds.instance.no_automated_backup"])]
    (sec,) = _sections(controls, framework="soc2")
    assert "SOC 2 CC7.5" in sec.control_tags
    # ISO tags come from the composite mapping when the pack framework is SOC 2.
    assert any(t.startswith("ISO 27001") for t in sec.control_tags)


def test_exception_narrative_without_reason():
    line = exception_narrative({"title": "T", "exception": {}})
    assert "No reason recorded" in line
    assert "unknown approver" in line
