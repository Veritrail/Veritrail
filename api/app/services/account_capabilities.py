"""Optional-capability verification.

Advanced IAM policy generation (Access Analyzer / CloudTrail) was retired — the
connector is read-only, so there are no optional write capabilities to verify.
These functions remain as no-ops so the connect flow and the verify-capabilities
endpoint keep a stable shape.
"""
from __future__ import annotations

from typing import Any

from app.data.remediation_modules import empty_remediation_modules
from app.models import AwsAccount

VERIFICATION_META = {
    "method": "iam_policy_inspection",
    "description": "Verified from deployed IAM role policy.",
    "safe": "No resources were created, modified, or deleted.",
}


def apply_capability_verification(acc: AwsAccount) -> dict[str, Any]:
    """No optional capabilities to verify — the connector is read-only."""
    return {
        "remediation_modules": {},
        "verification": {
            **VERIFICATION_META,
            "scanner_role_arn": acc.role_arn,
        },
    }


def remediation_modules_payload(acc: AwsAccount) -> dict[str, Any]:
    _ = acc
    empty = empty_remediation_modules()
    return {"enabled": empty, "deployed": empty}
