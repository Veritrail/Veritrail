"""Generate a sample narrative compliance PDF for visual review.

Usage: .venv/bin/python scripts/preview_pdf_report.py [output.pdf]
Synthetic data only — no database required.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services.pdf_report import build_pdf

now = datetime.now(timezone.utc)


def finding(fid, check_id, arn, title, sev="medium", status="open", exception=None):
    d = {
        "id": fid,
        "check_id": check_id,
        "resource_arn": arn,
        "title": title,
        "severity": sev,
        "status": status,
        "first_seen": (now - timedelta(days=21)).isoformat(),
        "last_seen": now.isoformat(),
    }
    if exception:
        d["exception"] = exception
    return d


def control(cid, title, checks, findings=None, exceptions=None, status="pass", evidence="complete"):
    return {
        "control_id": cid,
        "title": title,
        "description": "",
        "guidance": "",
        "status": status,
        "evidence_status": evidence,
        "finding_count": len(findings or []),
        "findings": findings or [],
        "exceptions": exceptions or [],
        "check_evidence_classes": {c: "benchmark" for c in checks},
    }


exc = {
    "reason": "Sandbox environment scheduled for decommission Q3 2026. Risk accepted.",
    "approved_by": "Alice Smith (CTO)",
    "expires_at": (now + timedelta(days=90)).isoformat(),
}

controls = [
    control("CC6.1", "CC6.1 - Logical Access Controls", ["iam.user.no_mfa", "iam.root.no_mfa", "iam.root.has_access_keys"]),
    control(
        "CC6.3",
        "CC6.3 - Access Reviews",
        ["iam.role.least_privilege_policy", "iam.policy.wildcard_resource"],
        findings=[
            finding("f1", "iam.role.least_privilege_policy", "arn:aws:iam::123456789012:role/dev-unrestricted", "Role dev-unrestricted has Action: * in inline policy", "high"),
            finding("f2", "iam.role.least_privilege_policy", "arn:aws:iam::123456789012:role/ci-runner", "Role ci-runner has Action: * in inline policy", "high"),
        ],
        status="fail",
        evidence="partial",
    ),
    control(
        "CC6.7",
        "CC6.7 - Encryption at Rest",
        ["s3.bucket.no_default_encryption", "kms.key.no_rotation", "ec2.ebs.volume_unencrypted", "rds.instance.no_encryption"],
        findings=[finding("f3", "s3.bucket.no_default_encryption", "arn:aws:s3:::legacy-assets", "Bucket legacy-assets has no default encryption", "medium")],
        exceptions=[
            finding("f4", "s3.bucket.no_default_encryption", "arn:aws:s3:::sandbox-scratch", "Bucket sandbox-scratch has no default encryption", "medium", status="excepted", exception=exc)
        ],
        status="fail",
    ),
    control(
        "CC6.6",
        "CC6.6 - Boundary Protection",
        ["ec2.security_group.unrestricted_ssh", "ec2.security_group.unrestricted_rdp", "rds.instance.publicly_accessible", "ec2.instance.imdsv2_not_required"],
        findings=[finding("f5", "ec2.security_group.unrestricted_ssh", "arn:aws:ec2:us-east-1:123456789012:security-group/sg-0a1b2c", "Security group sg-0a1b2c allows SSH from 0.0.0.0/0", "critical")],
        status="fail",
    ),
    control(
        "CC7.2",
        "CC7.2 - Security Event Monitoring",
        ["cloudtrail.trail.not_enabled", "cloudtrail.trail.no_log_validation", "aws.config.not_enabled", "vpc.flow_logs.not_enabled"],
    ),
    control("CC7.2b", "CC7.2 - Threat Detection", ["guardduty.detector.not_enabled", "aws.securityhub.not_enabled", "guardduty.open_findings"]),
    control(
        "CC8.1",
        "CC8.1 - Change Authorization",
        ["github.repo.no_branch_protection", "github.repo.insufficient_reviews", "github.repo.self_merge_allowed"],
    ),
    control(
        "CC7.5",
        "CC7.5 - System Operations - Recovery",
        ["rds.instance.no_automated_backup", "dynamodb.table.no_pitr", "backup.plan.missing", "rds.instance.no_multi_az"],
        findings=[finding("f6", "rds.instance.no_multi_az", "arn:aws:rds:us-east-1:123456789012:db:reporting-db", "RDS instance reporting-db is not Multi-AZ", "low")],
        status="fail",
    ),
    control("CC6.8", "CC6.8 - Malicious Software Detection", ["aws.inspector.active_critical_finding", "ecr.repository.image_scan_disabled"]),
    control("CC1.1", "CC1.1 - Integrity and Ethical Values", [], status="no_data", evidence="missing"),
]

acc = SimpleNamespace(label="prod", account_id="123456789012")
pdf = build_pdf(
    acc,
    "soc2",
    90,
    now,
    controls,
    since=now - timedelta(days=90),
    evidence_sources=["AWS IAM", "AWS CloudTrail", "AWS Config", "GitHub"],
    report_id="PREVIEW00001",
    coverage={"days_with_data": 62, "days_requested": 90, "successful_scans_in_period": 44},
    signature_enabled=True,
    pack_provenance={"pack_version": "2.0", "build": {"git_sha": "22a80813deadbeef"}, "check_registry": {"check_ids_hash": "9f2c11ab04e7d310"}},
    org_name="ACME Corp",
)

out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/veritrail-preview.pdf"
with open(out, "wb") as fh:
    fh.write(pdf)
print(f"wrote {out} ({len(pdf)} bytes)")
