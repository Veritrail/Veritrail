import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from botocore.exceptions import BotoCoreError, ClientError

from app.core.aws import assume_role
from app.core.db import get_db
from app.core.security import current_principal
from app.core.route_deps import RequireAdmin
from app.models import AwsAccount
from app.services.access_analyzer_policy import validate_policy, security_findings_only

router = APIRouter()


class ApplyPolicyIn(BaseModel):
    role_arn: str
    policy_name: str
    cleaned_policy: dict
    dry_run: bool = False


@router.post("/{account_id}/roles/apply-policy")
def apply_role_policy(
    account_id: str,
    body: ApplyPolicyIn,
    _rbac: RequireAdmin, p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Apply a generated IAM policy to a role.

    - For inline policies: PUT via iam:PutRolePolicy.
    - For managed policies: create a new version via iam:CreatePolicyVersion.
    - dry_run=True: validate without applying (IAM ValidatePolicy only).

    Logs the action to FindingEvent when a finding_id is provided.
    """
    acc = db.get(AwsAccount, uuid.UUID(account_id))
    if not acc or str(acc.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    if acc.status != "connected" or not acc.role_arn:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "account not connected or role not verified")

    try:
        sess = assume_role(
            acc.role_arn,
            acc.external_id,
            session_name="veritrail-apply-policy",
            aws_account=acc,
            purpose="apply_role_policy",
        )
    except (ClientError, BotoCoreError) as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=f"Cannot assume role: {e}")

    iam = sess.client("iam")

    # Extract role name from ARN
    role_name = body.role_arn.split("/")[-1] if "/" in body.role_arn else body.role_arn

    # Determine if this is a managed policy or inline policy
    is_managed = body.policy_name.startswith("arn:") or "/" in body.policy_name

    # Validate the policy document first
    policy_json = json.dumps(body.cleaned_policy)
    try:
        validation = validate_policy(iam, policy_json)
        security_issues = security_findings_only(validation)
    except Exception as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Policy validation failed: {e}")

    if dry_run := body.dry_run:
        return {
            "applied": False,
            "dry_run": True,
            "role_arn": body.role_arn,
            "policy_name": body.policy_name,
            "is_managed": is_managed,
            "validation": {
                "findings": validation,
                "security_findings": security_issues,
                "security_finding_count": len(security_issues),
            },
        }

    # Apply the policy
    try:
        if is_managed:
            # Managed policy — create a new version
            policy_arn = body.policy_name
            resp = iam.create_policy_version(
                PolicyArn=policy_arn,
                PolicyDocument=policy_json,
                SetAsDefault=True,
            )
            result = {
                "action": "create_policy_version",
                "policy_arn": policy_arn,
                "version_id": resp.get("PolicyVersion", {}).get("VersionId"),
                "is_default": resp.get("PolicyVersion", {}).get("IsDefaultVersion", False),
            }
        else:
            # Inline policy — PUT to role
            iam.put_role_policy(
                RoleName=role_name,
                PolicyName=body.policy_name,
                PolicyDocument=policy_json,
            )
            result = {
                "action": "put_role_policy",
                "role_name": role_name,
                "policy_name": body.policy_name,
            }
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "ClientError")
        msg = e.response.get("Error", {}).get("Message", str(e))
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"AWS API error ({code}): {msg}",
        ) from e
    except BotoCoreError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=f"AWS API unreachable: {e}")

    return {
        "applied": True,
        "dry_run": False,
        "role_arn": body.role_arn,
        "policy_name": body.policy_name,
        "is_managed": is_managed,
        "validation": {
            "security_findings": security_issues,
            "security_finding_count": len(security_issues),
        },
        **result,
    }


@router.get("/{account_id}/remediation-runner/status")
def remediation_runner_status(
    account_id: str,
    check_id: str | None = Query(default=None),
    resource_region: str | None = Query(default=None, description="AWS region of the finding resource"),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Read-only SSM Automation readiness (optional check_id selects runbook document)."""
    from app.services.remediation_runner_status import check_remediation_runner

    acc = db.get(AwsAccount, uuid.UUID(account_id))
    if not acc or str(acc.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    return check_remediation_runner(
        acc,
        check_id=check_id,
        resource_region=resource_region,
    )


