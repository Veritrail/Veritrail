import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.aws import ensure_veritrail_role_trust, verify_account
from app.core.config import get_settings
from app.core.db import get_db
from app.core.route_deps import RequireAdmin
from app.core.security import current_principal
from app.models import AwsAccount
from app.routes.accounts import (
    AccountOut,
    CloudTrailOnboardingIn,
    CloudTrailOnboardingOut,
    ConnectorUpdateArtifactsOut,
    ConnectorVersionOut,
    ConnectorVersionsListOut,
    VerifyIn,
    _account_out,
    _update_stack_name,
)

router = APIRouter()
settings = get_settings()


@router.patch("/{account_id}/cloudtrail-onboarding", response_model=CloudTrailOnboardingOut)
def update_cloudtrail_onboarding(
    account_id: str,
    body: CloudTrailOnboardingIn,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    acc = db.get(AwsAccount, uuid.UUID(account_id))
    if not acc or str(acc.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    mode = body.mode.strip().lower()
    if mode not in ("existing", "veritrail_managed"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "mode must be existing or veritrail_managed")
    acc.cloudtrail_onboarding_mode = mode
    db.commit()
    return CloudTrailOnboardingOut(mode=acc.cloudtrail_onboarding_mode)


@router.get("/{account_id}/cloudtrail-onboarding", response_model=CloudTrailOnboardingOut)
def get_cloudtrail_onboarding(account_id: str, p=Depends(current_principal), db: Session = Depends(get_db)):
    acc = db.get(AwsAccount, uuid.UUID(account_id))
    if not acc or str(acc.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    return CloudTrailOnboardingOut(mode=acc.cloudtrail_onboarding_mode)


@router.get("/connector-versions", response_model=ConnectorVersionsListOut)
def list_connector_versions(p=Depends(current_principal)):
    from app.services.cfn_versions import RECOMMENDED_CONNECTOR_VERSION, allowed_connector_versions

    _ = p
    return ConnectorVersionsListOut(
        recommended_version_tag=RECOMMENDED_CONNECTOR_VERSION,
        versions=[ConnectorVersionOut(**row) for row in allowed_connector_versions()],
    )


@router.get("/{account_id}/connector-update", response_model=ConnectorUpdateArtifactsOut)
def get_connector_update_artifacts(
    account_id: str,
    version_tag: str = Query(..., min_length=1, max_length=16),
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    from app.services.cfn_versions import (
        CONNECTOR_VERSIONS,
        RECOMMENDED_CONNECTOR_VERSION,
        cloudformation_stack_url,
        connector_template_url,
        update_cli_command,
        validate_connector_version_tag,
    )

    try:
        tag = validate_connector_version_tag(version_tag.strip())
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e

    acc = db.get(AwsAccount, uuid.UUID(account_id))
    if not acc or str(acc.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")

    version = next(v for v in CONNECTOR_VERSIONS if v.tag == tag)
    stack_name = _update_stack_name(acc)

    return ConnectorUpdateArtifactsOut(
        version_tag=tag,
        version_label=version.label,
        template_url=connector_template_url(tag),
        stack_name=stack_name,
        console_stack_url=cloudformation_stack_url(stack_name),
        update_cli_command=update_cli_command(
            external_id=acc.external_id,
            stack_name=stack_name,
            version_tag=tag,
        ),
        current_version_tag=get_settings().CFN_TEMPLATE_VERSION,
        recommended_version_tag=RECOMMENDED_CONNECTOR_VERSION,
    )


@router.post("/{account_id}/sync-local-trust", status_code=200)
def sync_local_trust(account_id: str, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    """Dev helper: add your current AWS caller (e.g. SSO) to VeritrailReadOnly trust policy."""
    if settings.APP_ENV != "dev":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only available in dev")
    acc = db.get(AwsAccount, uuid.UUID(account_id))
    if not acc or str(acc.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    if not acc.role_arn:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "connect the account first")
    updated = ensure_veritrail_role_trust(acc.role_arn, acc.external_id)
    return {"ok": True, "trust_policy_updated": updated}


@router.post("/{account_id}/verify", response_model=AccountOut)
def verify(account_id: str, body: VerifyIn, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    acc = db.get(AwsAccount, uuid.UUID(account_id))
    if not acc or str(acc.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    role_update = acc.status == "connected" and bool(acc.role_arn)
    ok, aws_account_id, alias, err = verify_account(body.role_arn, acc.external_id, aws_account=acc)
    if not ok:
        if acc.status != "connected":
            acc.last_error = err
            acc.status = "error"
        else:
            acc.last_error = None
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"assume role failed: {err}")
    acc.role_arn = body.role_arn
    acc.account_id = aws_account_id
    acc.label = alias or aws_account_id or acc.label
    acc.status = "connected"
    acc.last_error = None
    from app.services.account_capabilities import apply_capability_verification

    apply_capability_verification(acc)

    from app.models.org import Org
    from app.services.org_activity import record_activation_milestone

    org = db.get(Org, acc.org_id)
    if org:
        record_activation_milestone(
            db,
            org,
            "first_integration_at",
            actor_user_id=uuid.UUID(p["sub"]) if p.get("sub") else None,
            detail={"provider": "aws", "account_id": str(acc.id)},
        )

    db.commit()

    if not role_update:
        from app.worker.tasks import run_scan

        run_scan.delay(str(acc.id))

    return _account_out(acc)


@router.post("/{account_id}/verify-capabilities")
def verify_capabilities(account_id: str, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    """Confirm optional CFN capabilities are deployed (advanced policy generation)."""
    from app.services.account_capabilities import apply_capability_verification

    acc = db.get(AwsAccount, uuid.UUID(account_id))
    if not acc or str(acc.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    if acc.status != "connected" or not acc.role_arn:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Connect and verify the core scanner role before checking optional capabilities",
        )
    results = apply_capability_verification(acc)
    db.commit()
    verification = results.pop("verification", None)
    return {"account": _account_out(acc), "capabilities": results, "verification": verification}
