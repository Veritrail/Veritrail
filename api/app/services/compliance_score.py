"""Compliance score helpers for dashboard views (severity-weighted penalty model)."""

from __future__ import annotations

from typing import Any

_SEVERITY_PENALTY: dict[str, int] = {
    "critical": 40,
    "high": 20,
    "medium": 8,
    "low": 2,
    "info": 0,  # signal-only; never penalizes the compliance score
}

# Longest prefixes first so aws.config beats aws.
_DOMAIN_PREFIXES: tuple[tuple[str, str], ...] = (
    ("aws.access_analyzer.", "Access Analyzer"),
    ("aws.config.", "AWS Config"),
    ("aws.securityhub.", "Security Hub"),
    ("cloudtrail.", "CloudTrail"),
    ("guardduty.", "GuardDuty"),
    ("secretsmanager.", "Secrets Manager"),
    ("elasticloadbalancing.", "ELB"),
    ("dynamodb.", "DynamoDB"),
    ("ecr.", "ECR"),
    ("eks.", "EKS"),
    ("ecs.", "ECS"),
    ("github.", "GitHub"),
    ("gitlab.", "GitLab"),
    ("iam.", "IAM"),
    ("s3.", "S3"),
    ("kms.", "KMS"),
    ("vpc.", "VPC"),
    ("ec2.", "EC2"),
    ("ebs.", "EC2"),
    ("rds.", "RDS"),
    ("acm.", "ACM"),
    ("lambda.", "Lambda"),
    ("ssm.", "SSM"),
    ("elb.", "ELB"),
    ("sns.", "SNS"),
    ("sqs.", "SQS"),
)


def _domain_for_check(check_id: str) -> str:
    if not check_id:
        return "Other"
    for prefix, label in _DOMAIN_PREFIXES:
        if check_id.startswith(prefix):
            return label
    return "Other"


def _clamp_score(value: int) -> int:
    return max(0, min(100, value))


def _compute_compliance_score(
    findings: list[dict[str, Any]],
) -> tuple[int, dict[str, int], dict[str, int]]:
    """Return (overall_score, per_framework_scores, per_domain_scores)."""
    total_penalty = 0
    domain_penalty: dict[str, int] = {}

    for finding in findings:
        severity = str(finding.get("severity") or "low")
        penalty = _SEVERITY_PENALTY.get(severity, _SEVERITY_PENALTY["low"])
        total_penalty += penalty
        domain = _domain_for_check(str(finding.get("check_id") or ""))
        domain_penalty[domain] = domain_penalty.get(domain, 0) + penalty

    overall = _clamp_score(100 - total_penalty // 3)
    per_domain = {domain: _clamp_score(100 - penalty // 2) for domain, penalty in domain_penalty.items()}
    return overall, {}, per_domain
