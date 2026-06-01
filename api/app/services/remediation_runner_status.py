"""Verify customer-account SSM remediation automation (read-only)."""
from __future__ import annotations

from typing import Any

from botocore.exceptions import ClientError

from app.core.config import get_settings
from app.core.aws import assume_role
from app.models import AwsAccount
from app.services.iam_permission_check import (
    check_actions_on_documents,
    connector_can_start_document_automation,
)
from app.services.remediation_plan import (
    automation_home_region,
    resolve_automation_region,
)

DOCUMENT_NAME = "Vigil-RemediationPlanExecutor"  # legacy; new stacks use per-module runbooks

CONNECTOR_SSM_START_ACTIONS = (
    "ssm:DescribeDocument",
    "ssm:StartAutomationExecution",
    "ssm:GetAutomationExecution",
)


def connector_ssm_start_blockers(scanner_policy_documents: list[dict]) -> list[str]:
    """Blockers when the connector role cannot describe/start SSM from the API."""
    if not scanner_policy_documents:
        return [
            "Cannot read VigilScannerRole policies — update VigilAccountConnector with SSM remediation enabled"
        ]
    granted = check_actions_on_documents(scanner_policy_documents, CONNECTOR_SSM_START_ACTIONS)
    missing = [action for action, ok in granted.items() if not ok]
    if not missing:
        return []
    return [
        "VigilScannerRole cannot start SSM Automation "
        f"(missing {', '.join(missing)}). "
        "Update the VigilAccountConnector stack with remediation modules enabled "
        "(e.g. EnableIamAccessKeyRemediation=Yes), then Verify capabilities on Accounts."
    ]


def _enabled_module_check_ids(acc: AwsAccount) -> list[str]:
    from app.data.remediation_modules import MODULE_SAMPLE_CHECK_ID, REMEDIATION_MODULES

    check_ids: list[str] = []
    for spec in REMEDIATION_MODULES:
        if not spec.runner_supported:
            continue
        if not getattr(acc, spec.enable_column, False):
            continue
        sample = MODULE_SAMPLE_CHECK_ID.get(spec.id)
        if sample:
            check_ids.append(sample)
    return check_ids


def _is_vigil_document(document_name: str, runbook_owner: str | None) -> bool:
    if runbook_owner == "vigil":
        return True
    return document_name.startswith("Vigil-")


def _check_single_runbook(
    acc: AwsAccount,
    *,
    check_id: str | None,
    resource_region: str | None,
    session: Any,
    scanner_policy_documents: list[dict] | None,
) -> dict[str, Any]:
    from app.services.ssm_remediation_catalog import runbook_for_check

    settings = get_settings()
    automation_region = resolve_automation_region(check_id, resource_region)
    runbook = runbook_for_check(check_id) if check_id else None
    document_name = (
        runbook.document_name
        if runbook
        else (settings.REMEDIATION_SSM_DOCUMENT_NAME or DOCUMENT_NAME)
    )
    runbook_owner = runbook.owner if runbook else None

    out: dict[str, Any] = {
        "check_id": check_id,
        "automation_region": automation_region,
        "resource_region": resource_region,
        "document": {"name": document_name, "exists": False, "status": None},
        "ready": False,
        "blockers": [],
        "warnings": [],
        "hints": [],
    }

    ssm = session.client("ssm", region_name=automation_region)
    try:
        doc = ssm.describe_document(Name=document_name)
        status = (doc.get("Document") or {}).get("Status")
        out["document"]["exists"] = True
        out["document"]["status"] = status
        if status not in (None, "Active"):
            out["blockers"].append(f"SSM document {document_name} exists but Status={status}")
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code")
        if code in ("InvalidDocument", "InvalidDocumentOperation"):
            if _is_vigil_document(document_name, runbook_owner):
                home = automation_home_region()
                out["blockers"].append(
                    f"Vigil runbook {document_name} is not deployed in {automation_region} "
                    f"(automation home region is {home}). Deploy vigil-remediation-ssm.yaml in that "
                    "region with the matching Enable*Remediation parameters set to Yes."
                )
            else:
                out["blockers"].append(
                    f"AWS runbook {document_name} is not available in {automation_region}. "
                    "AWS-owned documents are regional — enable the module and deploy in the target region."
                )
        elif code == "AccessDeniedException":
            out["blockers"].append(
                f"Connector role cannot access ssm:DescribeDocument in {automation_region}. "
                "Update VigilAccountConnector (vigil-core-scanner.yaml) with remediation modules enabled."
            )
        else:
            out["blockers"].append(f"Cannot describe SSM document {document_name}: {e}")

    if scanner_policy_documents is not None:
        if (
            _is_vigil_document(document_name, runbook_owner)
            and out["document"].get("exists")
            and not connector_can_start_document_automation(scanner_policy_documents, document_name)
        ):
            out["blockers"].append(
                f"Connector IAM must allow ssm:StartAutomationExecution on document/{document_name} "
                f"in {automation_region} (update vigil-core-scanner.yaml)."
            )

    out["ready"] = not out["blockers"] and out["document"].get("exists")
    if runbook and runbook.owner == "aws":
        out["warnings"].append(f"AWS-owned runbook {document_name}.")
    return out


def check_remediation_runner(
    acc: AwsAccount,
    *,
    check_id: str | None = None,
    resource_region: str | None = None,
    session: Any | None = None,
    scanner_policy_documents: list[dict] | None = None,
) -> dict[str, Any]:
    """Inspect SSM Automation readiness (live DescribeDocument, not cached)."""
    settings = get_settings()
    home = automation_home_region()

    out: dict[str, Any] = {
        "automation_region": home,
        "resource_region": resource_region,
        "document": {"name": None, "exists": False, "status": None},
        "ready": False,
        "rule": {"name": None, "exists": False, "state": None},
        "lambda": {"name": None, "exists": False, "deprecated": True},
        "schema_discovery": {"enabled": None, "note": "SSM Automation only — no Lambda runner"},
        "blockers": [],
        "warnings": [],
        "hints": [],
        "documents": [],
    }

    if not acc.role_arn:
        out["blockers"].append("AWS account role not verified — connect account first")
        return out

    sess = session
    if sess is None:
        try:
            sess = assume_role(
                acc.role_arn,
                acc.external_id,
                session_name="vigil-remediation-check",
                aws_account=acc,
                purpose="remediation_runner_status",
            )
        except Exception as exc:  # noqa: BLE001
            out["blockers"].append(f"Cannot assume role: {exc}")
            return out

    if check_id:
        checks = [check_id]
    else:
        checks = _enabled_module_check_ids(acc)
        if not checks:
            checks = [None]  # noqa: allow legacy single-doc probe when no modules flagged

    partials: list[dict[str, Any]] = []
    for cid in checks:
        partials.append(
            _check_single_runbook(
                acc,
                check_id=cid,
                resource_region=resource_region,
                session=sess,
                scanner_policy_documents=scanner_policy_documents,
            )
        )

    if scanner_policy_documents is not None and checks != [None]:
        out["blockers"].extend(connector_ssm_start_blockers(scanner_policy_documents))

    seen_blockers: set[str] = set()
    for partial in partials:
        out["documents"].append(partial["document"])
        for b in partial["blockers"]:
            if b not in seen_blockers:
                seen_blockers.add(b)
                out["blockers"].append(b)
        out["warnings"].extend(partial["warnings"])

    primary = partials[0] if partials else None
    if primary:
        out["automation_region"] = primary["automation_region"]
        out["document"] = primary["document"]
        out["rule"] = {
            "name": primary["document"]["name"],
            "exists": primary["document"]["exists"],
            "state": primary["document"]["status"],
        }

    out["ready"] = bool(partials) and all(p["ready"] for p in partials) and not out["blockers"]

    if out["ready"]:
        out["hints"] = [
            f"SSM remediation runbooks are active (checked {len(partials)} module document(s)).",
            "Approve on the finding, then start automation. Re-scan after remediation.",
        ]
    else:
        out["hints"] = [
            "Deploy vigil-remediation-ssm.yaml in the automation home region with Enable*Remediation=Yes.",
            f"Automation home region: {home} (REMEDIATION_AUTOMATION_REGION).",
            "Connector needs ssm:DescribeDocument and ssm:StartAutomationExecution.",
        ]
        if checks == [None]:
            out["hints"].append(
                "Enable at least one remediation module on the connector stack, then verify again."
            )

    return out
