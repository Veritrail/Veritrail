"""Verify optional capabilities via IAM policy inspection (no resource mutations)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from botocore.exceptions import ClientError

from app.core.aws import assume_role
from app.data.remediation_modules import empty_remediation_modules
from app.models import AwsAccount
from app.services.iam_permission_check import (
    check_actions_on_documents,
    load_role_policy_documents,
)
from app.services.access_analyzer_policy import (
    cloudtrail_monitor_role_exists,
    cloudtrail_monitor_role_name,
)

ADVANCED_POLICY_ACTIONS = (
    "iam:GenerateServiceLastAccessedDetails",
    "access-analyzer:StartPolicyGeneration",
    "access-analyzer:CancelPolicyGeneration",
    "access-analyzer:GetGeneratedPolicy",
    "access-analyzer:ListPolicyGenerations",
    "iam:PassRole",
)

VERIFICATION_META = {
    "method": "iam_policy_inspection",
    "description": "Verified from deployed IAM role policy.",
    "safe": "No resources were created, modified, or deleted.",
}


@dataclass
class CapabilityVerificationContext:
    """One AssumeRole + cached IAM reads for a single Verify click."""

    session: Any | None = None
    account_id: str | None = None
    session_error: str | None = None
    scanner_role_name: str = ""
    scanner_documents: list[dict[str, Any]] = field(default_factory=list)


def _permission_rows(actions: tuple[str, ...], granted: dict[str, bool]) -> list[dict[str, Any]]:
    return [{"action": a, "granted": bool(granted.get(a))} for a in actions]


def _module_result(
    *,
    requested: bool,
    role_arn: str | None = None,
) -> dict[str, Any]:
    return {
        "requested": requested,
        "deployed": False,
        "status": "not_requested",
        "assumable": None,
        "role_arn": role_arn,
        "error": None,
        "permissions": [],
        "granted_count": 0,
        "required_count": 0,
        "policy_found": False,
        "runner_ready": None,
    }


def _finalize_module_result(result: dict[str, Any]) -> dict[str, Any]:
    if not result["requested"]:
        result["status"] = "not_requested"
        return result
    if result.get("assumable") is False:
        result["status"] = "not_assumable"
    elif result["deployed"]:
        result["status"] = "ready"
    else:
        result["status"] = "missing_permissions"
    return result


def _scanner_session(acc: AwsAccount) -> tuple[Any | None, str | None, str | None]:
    """Assume saved scanner role ARN and confirm with sts:GetCallerIdentity."""
    if not acc.role_arn:
        return None, None, "Connect the core scanner role first"
    try:
        sess = assume_role(
            acc.role_arn,
            acc.external_id,
            session_name="veritrail-capability-verify",
            aws_account=acc,
            purpose="capability_verify",
        )
        ident = sess.client("sts").get_caller_identity()
        return sess, ident.get("Account"), None
    except ClientError as exc:
        return None, None, str(exc)
    except Exception as exc:  # noqa: BLE001
        return None, None, str(exc)


def build_capability_verification_context(acc: AwsAccount) -> CapabilityVerificationContext:
    """Single AWS session + policy snapshot for capability checks."""
    if not acc.role_arn:
        return CapabilityVerificationContext(session_error="Connect the Veritrail connector role first")

    sess, account_id, sess_err = _scanner_session(acc)
    if not sess:
        return CapabilityVerificationContext(session_error=sess_err)

    scanner_role_name = acc.role_arn.rsplit("/", 1)[-1]
    iam = sess.client("iam")
    scanner_documents = load_role_policy_documents(iam, scanner_role_name)

    return CapabilityVerificationContext(
        session=sess,
        account_id=account_id,
        scanner_role_name=scanner_role_name,
        scanner_documents=scanner_documents,
    )


def _verify_advanced_with_ctx(acc: AwsAccount, ctx: CapabilityVerificationContext) -> dict[str, Any]:
    wanted = bool(acc.enable_advanced_policy_generation)
    result = _module_result(requested=wanted, role_arn=acc.role_arn)
    result["required_count"] = len(ADVANCED_POLICY_ACTIONS)

    if ctx.session_error:
        result["assumable"] = False
        result["error"] = ctx.session_error
        return _finalize_module_result(result)

    result["assumable"] = True
    granted = check_actions_on_documents(ctx.scanner_documents, ADVANCED_POLICY_ACTIONS)
    rows = _permission_rows(ADVANCED_POLICY_ACTIONS, granted)
    monitor_name = cloudtrail_monitor_role_name(acc.role_arn)
    monitor_ok = cloudtrail_monitor_role_exists(ctx.session, acc.role_arn) if monitor_name else False
    result["permissions"] = rows
    result["required_count"] = len(ADVANCED_POLICY_ACTIONS)
    action_granted = sum(1 for r in rows if r["granted"])
    result["granted_count"] = action_granted
    result["cloudtrail_monitor_role"] = monitor_name
    result["cloudtrail_monitor_role_present"] = monitor_ok
    result["deployed"] = action_granted == result["required_count"] and monitor_ok
    if not result["deployed"]:
        missing = [r["action"] for r in rows if not r["granted"]]
        if monitor_name and not monitor_ok and not missing:
            result["error"] = (
                "Advanced policy generation stack is incomplete. "
                "Update the Veritrail connector (Advanced IAM policy generation), then verify again."
            )
        elif monitor_name and not monitor_ok:
            result["error"] = (
                "Advanced policy generation stack is incomplete. "
                f"Missing: {', '.join(missing)}. "
                "Update the Veritrail connector, then verify again."
            )
        else:
            result["error"] = f"Missing permissions: {', '.join(missing)}"

    result["requested"] = wanted or result["deployed"]
    return _finalize_module_result(result)


def verify_advanced_policy_generation(
    acc: AwsAccount, ctx: CapabilityVerificationContext | None = None
) -> dict[str, Any]:
    """Inspect connector role IAM policies; deployed = permissions present on role_arn."""
    if ctx is None:
        ctx = build_capability_verification_context(acc)
    return _verify_advanced_with_ctx(acc, ctx)


def apply_capability_verification(acc: AwsAccount) -> dict[str, Any]:
    """Update advanced-policy deployed + enabled flags from IAM inspection."""
    ctx = build_capability_verification_context(acc)

    adv = verify_advanced_policy_generation(acc, ctx)
    acc.advanced_policy_generation_deployed = adv["deployed"]
    if adv["deployed"]:
        acc.enable_advanced_policy_generation = True

    return {
        "advanced_policy_generation": adv,
        "ssm_remediation": {
            "requested": False,
            "deployed": False,
            "ready": False,
            "status": "not_requested",
            "blockers": [],
            "error": None,
            "runner_status": None,
        },
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
