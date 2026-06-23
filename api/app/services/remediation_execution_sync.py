"""Poll SSM Automation execution status and persist terminal outcomes."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from botocore.exceptions import ClientError
from sqlalchemy.orm import Session

from app.core.aws import assume_role
from app.models.aws_account import AwsAccount
from app.models.remediation_execution import RemediationExecution
from app.services.remediation_plan import automation_home_region

_SUCCESS_SSM = frozenset({"Success", "CompletedWithSuccess", "Completed"})
_TERMINAL_SSM = _SUCCESS_SSM | frozenset(
    {"Failed", "TimedOut", "Cancelled", "Cancelling", "CompletedWithFailure", "Exited"}
)


def _automation_execution_body(resp: dict[str, Any]) -> dict[str, Any]:
    """Boto3 nests fields under AutomationExecution; accept flat mocks in tests."""
    body = resp.get("AutomationExecution")
    return body if isinstance(body, dict) else resp


def _parse_plan_result(outputs: dict[str, Any] | None) -> dict[str, Any] | None:
    if not outputs:
        return None
    for key in ("ExecutePlan", "executePlan"):
        raw = outputs.get(key)
        if not raw:
            continue
        text = raw[0] if isinstance(raw, list) and raw else raw
        if not isinstance(text, str):
            continue
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue
    return None


def _execution_regions(row: RemediationExecution, meta: dict[str, Any]) -> list[str]:
    plan = row.plan_json if isinstance(row.plan_json, dict) else {}
    candidates = [
        meta.get("region"),
        plan.get("automation_region"),
        plan.get("resource_region"),
        automation_home_region(),
    ]
    regions: list[str] = []
    for value in candidates:
        if isinstance(value, str) and value and value not in regions:
            regions.append(value)
    return regions


def _get_automation_execution(
    session: Any,
    *,
    exec_id: str,
    regions: list[str],
) -> tuple[dict[str, Any] | None, str | None, str | None]:
    """Try GetAutomationExecution in each region until one succeeds."""
    last_error: str | None = None
    for region in regions:
        try:
            resp = session.client("ssm", region_name=region).get_automation_execution(
                AutomationExecutionId=exec_id,
            )
            return _automation_execution_body(resp), region, None
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            last_error = f"{code} in {region}"
            if code in {"InvalidAutomationExecutionId", "AutomationExecutionNotFound"}:
                continue
            return None, region, last_error
        except Exception as exc:  # noqa: BLE001
            return None, region, str(exc)[:500]
    return None, None, last_error or "execution_not_found"


def sync_remediation_execution_from_ssm(
    db: Session,
    *,
    row: RemediationExecution,
    account: AwsAccount,
) -> tuple[RemediationExecution, dict[str, Any]]:
    """If execution is in-flight, refresh status from ssm:GetAutomationExecution."""
    sync_meta: dict[str, Any] = {"polled": False, "ssm_status": None, "error": None, "region": None}

    if row.status not in ("running", "dispatched"):
        return row, sync_meta

    meta = row.result_json if isinstance(row.result_json, dict) else {}
    exec_id = meta.get("automation_execution_id")
    if not exec_id:
        sync_meta["error"] = "missing_automation_execution_id"
        return row, sync_meta

    regions = _execution_regions(row, meta)
    if not regions:
        sync_meta["error"] = "missing_automation_region"
        return row, sync_meta

    try:
        sess = assume_role(
            account.role_arn,
            account.external_id,
            session_name="veritrail-remediation-status",
            aws_account=account,
            purpose="sync_remediation_execution",
        )
    except Exception as exc:  # noqa: BLE001
        sync_meta["error"] = f"assume_role_failed: {exc}"[:500]
        return row, sync_meta

    sync_meta["polled"] = True
    ae, polled_region, poll_error = _get_automation_execution(sess, exec_id=exec_id, regions=regions)
    if poll_error:
        sync_meta["error"] = poll_error
        return row, sync_meta
    if not ae:
        sync_meta["error"] = "execution_not_found"
        return row, sync_meta

    sync_meta["region"] = polled_region
    ssm_status = ae.get("AutomationExecutionStatus") or ""
    sync_meta["ssm_status"] = ssm_status
    if ssm_status not in _TERMINAL_SSM:
        return row, sync_meta

    now = datetime.now(timezone.utc)
    outputs = ae.get("Outputs") or {}
    plan_result = _parse_plan_result(outputs)
    merged_result = {
        **meta,
        "ssm_status": ssm_status,
        "ssm_outputs": outputs,
        "region": polled_region or meta.get("region"),
    }
    if plan_result:
        merged_result["plan_result"] = plan_result

    if ssm_status in _SUCCESS_SSM:
        ok = plan_result.get("ok", True) if plan_result else True
        row.status = "success" if ok else "failed"
        row.error = None if ok else str(plan_result.get("error") or "automation_step_failed")[:2000]
        row.result_json = merged_result
        row.completed_at = now
    else:
        row.status = "failed"
        row.error = (
            ae.get("FailureMessage")
            or (plan_result or {}).get("error")
            or ssm_status
            or "automation_failed"
        )[:2000]
        row.result_json = merged_result
        row.completed_at = now

    db.commit()
    db.refresh(row)
    return row, sync_meta
