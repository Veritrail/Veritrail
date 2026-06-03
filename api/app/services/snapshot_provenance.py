"""Collector provenance embedded in evidence snapshot payloads."""
from __future__ import annotations

import uuid
from typing import Any

SCHEMA = "vigil_snapshot_provenance/v1"

# entity_type -> (collector module, primary AWS API)
ENTITY_PROVENANCE: dict[str, tuple[str, str]] = {
    "account_summary": ("collect_iam", "iam:GetAccountSummary"),
    "iam_user": ("collect_iam", "iam:ListUsers"),
    "iam_access_key": ("collect_iam", "iam:ListAccessKeys"),
    "iam_role": ("collect_iam", "iam:ListRoles"),
    "iam_password_policy": ("collect_iam", "iam:GetAccountPasswordPolicy"),
    "s3_bucket": ("collect_s3", "s3:ListBuckets"),
    "s3_account_public_access_block": ("collect_s3", "s3control:GetPublicAccessBlock"),
    "kms_key": ("collect_kms", "kms:ListKeys"),
    "cloudtrail_trail": ("collect_cloudtrail", "cloudtrail:DescribeTrails"),
    "identity_center_user": ("collect_identity_center", "identitystore:ListUsers"),
    "identity_center_permission_set": (
        "collect_identity_center",
        "sso-admin:ListPermissionSets,ListAccountsForProvisionedPermissionSet,ListAccountAssignments",
    ),
    "guardduty_finding": ("collect_guardduty", "guardduty:ListFindings"),
    "config_rule_compliance": ("collect_config", "config:DescribeComplianceByConfigRule"),
}


def provenance_block(
    entity_type: str,
    scan_run_id: uuid.UUID,
    *,
    region: str | None = None,
) -> dict[str, Any]:
    collector, source_api = ENTITY_PROVENANCE.get(entity_type, ("run_scan", "vigil:aggregate"))
    block: dict[str, Any] = {
        "schema": SCHEMA,
        "collector": collector,
        "source_api": source_api,
        "scan_run_id": str(scan_run_id),
    }
    if region:
        block["region"] = region
    return block


def attach_provenance(payload: dict[str, Any], entity_type: str, scan_run_id: uuid.UUID) -> dict[str, Any]:
    region = payload.get("region") if isinstance(payload.get("region"), str) else None
    return {
        **payload,
        "_provenance": provenance_block(entity_type, scan_run_id, region=region),
    }
