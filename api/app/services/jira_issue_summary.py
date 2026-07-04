"""Build Jira issue summaries without duplicating resource names in the title."""
from __future__ import annotations

import re

_VERITRAIL_PREFIX = "[Veritrail]"

_ASSET_TYPE_LABELS: dict[str, str] = {
    "iam.root": "Root Account",
    "iam.user": "IAM User",
    "iam.role": "IAM Role",
    "iam.access_key": "Access Key",
    "iam.policy": "IAM Policy",
    "iam.perm": "IAM Role",
    "iam.account": "Account Setting",
    "s3.bucket": "S3 Bucket",
    "ec2.ebs": "EBS Volume",
}

_TITLE_CASE_ACRONYMS = {
    "iam": "IAM",
    "aws": "AWS",
    "s3": "S3",
    "kms": "KMS",
    "ec2": "EC2",
    "rds": "RDS",
    "eks": "EKS",
    "ecr": "ECR",
    "ecs": "ECS",
    "acm": "ACM",
    "ssm": "SSM",
    "sns": "SNS",
    "sqs": "SQS",
    "elb": "ELB",
}

_EMBEDDED_RESOURCE_RE = re.compile(r"^(.+?)\s+[`']([^`']+)[`'](.*)$", re.DOTALL)
_NAME_BOUNDARY_RE_TEMPLATE = r"\b{}\b"


def _resource_name(resource_arn: str) -> str:
    value = (resource_arn or "").strip()
    if not value:
        return "Affected resource"
    return value.rsplit("/", 1)[-1].rsplit(":", 1)[-1] or value


def _asset_type_label(check_id: str) -> str:
    for prefix, label in _ASSET_TYPE_LABELS.items():
        if check_id.startswith(prefix):
            return label
    parts = check_id.split(".")
    if len(parts) >= 2:
        service = parts[0].upper()
        noun = parts[1].replace("_", " ")
        return f"{service} {noun.title()}"
    return "AWS resource"


def _title_case_label(label: str) -> str:
    return " ".join(
        _TITLE_CASE_ACRONYMS.get(word.lower(), word[:1].upper() + word[1:])
        for word in label.split()
    )


def _normalize_type_label(title_type: str, check_type_label: str) -> str:
    title_type = title_type.strip()
    if not title_type:
        return check_type_label
    title_lower = title_type.lower()
    check_lower = check_type_label.lower()
    if title_lower in {"role", "user"}:
        return check_type_label
    if title_lower == check_lower or title_lower in check_lower or check_lower in title_lower:
        return check_type_label
    return _title_case_label(title_type)


def _names_match(embedded_name: str, short_name: str) -> bool:
    return embedded_name == short_name or embedded_name.lower() == short_name.lower()


def _clean_detail(rest: str) -> str:
    cleaned = re.sub(r"^\s*—\s*", "", rest.strip())
    return cleaned.strip()


def _parse_embedded_title(title: str) -> tuple[str, str, str] | None:
    match = _EMBEDDED_RESOURCE_RE.match(title)
    if not match:
        return None
    return match.group(1).strip(), match.group(2).strip(), _clean_detail(match.group(3))


def _violation_summary_from_check(check_id: str) -> str:
    if "least_privilege" in check_id:
        return "Least privilege violation"
    parts = check_id.split(".")
    if len(parts) >= 2:
        noun = parts[-1].replace("_", " ")
        if noun:
            return noun[0].upper() + noun[1:]
    return "Security finding"


def _extract_violation_summary(detail: str, check_id: str) -> str:
    text = detail.strip()
    if not text:
        return _violation_summary_from_check(check_id)
    if text.lower().startswith("least privilege violation"):
        return "Least privilege violation"
    return text[0].upper() + text[1:]


def _violation_from_display_title(display_title: str, short_name: str, check_id: str) -> str:
    pattern = _NAME_BOUNDARY_RE_TEMPLATE.format(re.escape(short_name))
    match = re.search(pattern, display_title, re.IGNORECASE)
    if match and match.start() > 0:
        after = _clean_detail(display_title[match.end() :])
        if after:
            return _extract_violation_summary(after, check_id)
    return _extract_violation_summary(display_title, check_id)


def build_jira_issue_summary(*, check_id: str, resource_arn: str, title: str) -> str:
    short_name = _resource_name(resource_arn)
    display_title = (title or "").strip()

    parsed = _parse_embedded_title(display_title)
    if parsed:
        _title_type, embedded_name, detail = parsed
        if _names_match(embedded_name, short_name):
            violation = _extract_violation_summary(detail, check_id)
            return f"{_VERITRAIL_PREFIX} {violation}: {short_name}"

    if short_name and short_name.lower() in display_title.lower():
        violation = _violation_from_display_title(display_title, short_name, check_id)
        return f"{_VERITRAIL_PREFIX} {violation}: {short_name}"

    violation = _extract_violation_summary(display_title, check_id)
    return f"{_VERITRAIL_PREFIX} {violation}: {short_name}"
