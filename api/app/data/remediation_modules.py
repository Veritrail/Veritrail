"""Remediation automation modules — retired (scan-only).

DB enable/deployed columns remain for one release; API returns empty/all-false defaults.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RemediationModuleSpec:
    id: str
    label: str
    badge_label: str
    enable_column: str
    deployed_column: str
    cfn_parameter: str
    iam_policy_name: str
    permissions: tuple[str, ...]
    runner_supported: bool


SSM_EXECUTOR_POLICY_NAME = "VeritrailRemediationAutomation"
DEFAULT_REMEDIATION_ROLE_NAME = "VeritrailRemediationAutomationRole"

# Write remediation retired — no modules offered.
REMEDIATION_MODULES: tuple[RemediationModuleSpec, ...] = ()
REMEDIATION_MODULE_BY_ID: dict[str, RemediationModuleSpec] = {}
MODULE_SAMPLE_CHECK_ID: dict[str, str] = {}
CHECK_TO_REMEDIATION_MODULE: dict[str, str] = {}

# Stable keys for API schemas / clients during the transition release.
REMEDIATION_MODULE_IDS: tuple[str, ...] = (
    "security_groups",
    "s3_public_access",
    "iam_access_keys",
    "iam_policies",
    "ssm_parameters",
    "cloudtrail_logging",
    "kms_rotation",
)


def remediation_module_for_check(check_id: str) -> str | None:
    return None


def empty_remediation_modules() -> dict[str, bool]:
    return {mid: False for mid in REMEDIATION_MODULE_IDS}


def remediation_modules_dict(acc: Any) -> dict[str, bool]:
    _ = acc
    return empty_remediation_modules()


def remediation_deployed_dict(acc: Any) -> dict[str, bool]:
    _ = acc
    return empty_remediation_modules()


def any_remediation_enabled(modules: dict[str, bool]) -> bool:
    return any(modules.values())


def set_remediation_modules(acc: Any, modules: dict[str, bool]) -> None:
    """No-op: write remediation retired; DB columns left unchanged."""
    _ = (acc, modules)


def clear_remediation_deployed(acc: Any, *, module_id: str | None = None) -> None:
    _ = (acc, module_id)
