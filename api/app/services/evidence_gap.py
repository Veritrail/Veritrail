"""Coverage gaps where Veritrail cannot auto-collect AWS evidence (external intake eligible)."""
from __future__ import annotations

ABSENCE_GAP_SUFFIXES = (".not_detected", ".not_enabled", ".missing")

CAPABILITY_NAMES: dict[str, str] = {
    "aws.vulnerability_monitoring.not_detected": "Vulnerability management",
    "vpc.flow_logs.not_enabled": "VPC flow logging",
    "aws.config.not_enabled": "AWS Config",
    "guardduty.detector.not_enabled": "GuardDuty threat detection",
    "aws.securityhub.not_enabled": "AWS Security Hub",
    "aws.access_analyzer.not_enabled": "IAM Access Analyzer",
    "cloudtrail.trail.not_enabled": "CloudTrail logging",
    "backup.plan.missing": "AWS Backup plan coverage",
}

ACTIONS: dict[str, dict[str, str]] = {
    "aws.vulnerability_monitoring.not_detected": {
        "external_option": (
            "Provide evidence that you manage vulnerability management outside AWS "
            "(e.g. Wiz, Orca, Snyk, or Tenable export or dashboard link)."
        ),
        "aws_option": "Enable AWS Inspector and container/image scanning in this account.",
    },
    "vpc.flow_logs.not_enabled": {
        "external_option": (
            "Provide evidence of equivalent network visibility — e.g. transit gateway flow logs, "
            "traffic mirroring to an NDR appliance, or a SIEM ingesting equivalent telemetry."
        ),
        "aws_option": "Enable VPC flow logs on in-scope VPCs.",
    },
    "aws.config.not_enabled": {
        "external_option": (
            "Provide evidence that configuration monitoring is covered elsewhere "
            "(e.g. a CSPM such as Wiz, Orca, or Prisma)."
        ),
        "aws_option": "Enable the AWS Config recorder and delivery channel in this account.",
    },
}


def is_absence_gap_check(check_id: str) -> bool:
    return any(check_id.endswith(suffix) for suffix in ABSENCE_GAP_SUFFIXES)


def open_absence_gap_check_ids(check_ids: list[str], open_by_check: dict[str, list]) -> list[str]:
    return [cid for cid in check_ids if is_absence_gap_check(cid) and open_by_check.get(cid)]


def absence_gap_capability_name(check_id: str) -> str:
    return CAPABILITY_NAMES.get(check_id, check_id.rsplit(".", 1)[-1].replace("_", " "))


def _default_actions(capability: str, check_id: str) -> dict[str, str]:
    lower = capability.lower()
    if check_id.endswith(".not_detected"):
        return {
            "external_option": f"Provide evidence that you manage {lower} outside AWS.",
            "aws_option": f"Enable the corresponding AWS capability for {lower} in this account.",
        }
    if check_id.endswith(".missing"):
        return {
            "external_option": f"Provide evidence that {lower} is covered another way.",
            "aws_option": f"Configure {lower} in AWS for in-scope resources.",
        }
    return {
        "external_option": f"Provide evidence of an equivalent control that covers {lower}.",
        "aws_option": f"Enable {lower} in this account.",
    }


def absence_gap_prompt(check_id: str) -> dict[str, str]:
    capability = absence_gap_capability_name(check_id)
    actions = ACTIONS.get(check_id) or _default_actions(capability, check_id)
    return {"capability": capability, **actions}
