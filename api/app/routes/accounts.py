import secrets
import uuid
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import current_principal
from app.models import AwsAccount
from app.models.azure_subscription import AzureSubscription
from app.models.gcp_project import GcpProject
from app.data.remediation_modules import (
    REMEDIATION_MODULES,
    any_remediation_enabled,
    remediation_deployed_dict,
    remediation_modules_dict,
    set_remediation_modules,
)
from app.models.org import Org
from app.core.route_deps import RequireAdmin
from app.services.org_activity import log_org_activity
from app.data.plans import get_plan, plan_account_limit

router = APIRouter()
settings = get_settings()


class RemediationModulesIn(BaseModel):
    security_groups: bool = False
    s3_public_access: bool = False
    iam_access_keys: bool = False
    iam_policies: bool = False
    ssm_parameters: bool = False
    cloudtrail_logging: bool = False
    kms_rotation: bool = False


class AccountIn(BaseModel):
    label: str = "AWS Account"
    enable_advanced_policy_generation: bool = False
    remediation_modules: RemediationModulesIn = RemediationModulesIn()


class ConnectionOptionsIn(BaseModel):
    enable_advanced_policy_generation: bool
    remediation_modules: RemediationModulesIn


class AccountOut(BaseModel):
    id: str
    label: str
    account_id: str | None
    status: str
    external_id: str
    role_arn: str | None = None
    enable_advanced_policy_generation: bool = False
    remediation_modules: RemediationModulesIn
    remediation_modules_deployed: RemediationModulesIn
    advanced_policy_generation_deployed: bool = False
    cfn_stack_name: str = "VeritrailAccountConnector"
    cfn_launch_url: str | None = None
    cfn_update_launch_url: str | None = None
    cfn_template_url: str | None = None
    cfn_cli_command: str | None = None
    cfn_update_cli_command: str | None = None
    remediation_cfn_launch_url: str | None = None
    remediation_cfn_template_url: str | None = None
    remediation_cfn_cli_command: str | None = None
    cfn_template_version: str | None = None
    last_scan_at: datetime | None = None
    last_error: str | None = None
    cloudtrail_onboarding_mode: str | None = None


class CloudTrailOnboardingIn(BaseModel):
    mode: str  # existing | veritrail_managed


class CloudTrailOnboardingOut(BaseModel):
    mode: str | None


class VerifyIn(BaseModel):
    role_arn: str

    @model_validator(mode="after")
    def _strip_role_arn(self):
        self.role_arn = "".join(self.role_arn.split())
        return self


class ConnectorVersionOut(BaseModel):
    tag: str
    label: str
    status: str
    notes: str
    template_url: str


class ConnectorVersionsListOut(BaseModel):
    recommended_version_tag: str
    versions: list[ConnectorVersionOut]


class ConnectorUpdateArtifactsOut(BaseModel):
    version_tag: str
    version_label: str
    template_url: str
    stack_name: str
    console_stack_url: str
    update_cli_command: str
    current_version_tag: str | None
    recommended_version_tag: str


def _yes_no(flag: bool) -> str:
    return "Yes" if flag else "No"


def _remediation_modules_in(modules: dict[str, bool]) -> RemediationModulesIn:
    return RemediationModulesIn(**{m.id: bool(modules.get(m.id, False)) for m in REMEDIATION_MODULES})


def _modules_from_body(body: RemediationModulesIn) -> dict[str, bool]:
    return body.model_dump()


def _cfn_console_base_url() -> str:
    """CloudFormation console deep links (global host + region param — works with IAM Identity Center SSO)."""
    region = settings.CFN_CONSOLE_REGION or "us-east-1"
    return f"https://console.aws.amazon.com/cloudformation/home?region={region}"


def _cfn_stack_list_url(stack_name: str) -> str:
    """Open the stack list filtered to one stack (AWS has no reliable update-wizard deep link)."""
    name = (stack_name or "").strip() or settings.CFN_STACK_NAME
    return (
        f"{_cfn_console_base_url()}#/stacks"
        f"?filteringText={quote(name, safe='')}&filteringStatus=active"
    )


def _cfn_stack_params(
    external_id: str,
    *,
    stack_name: str,
    enable_advanced_policy_generation: bool,
    remediation_modules: dict[str, bool],
) -> dict[str, str]:
    s = get_settings()
    from app.services.cfn_versions import RECOMMENDED_CONNECTOR_VERSION, connector_child_template_url

    params = {
        "templateURL": s.CFN_TEMPLATE_URL,
        "stackName": stack_name,
        "param_ExternalId": external_id,
        "param_VeritrailAccountPrincipal": s.TRUST_PRINCIPAL_ARN,
        "param_RoleName": s.CFN_SCANNER_ROLE_NAME,
        "param_CoreScannerTemplateURL": connector_child_template_url(
            RECOMMENDED_CONNECTOR_VERSION,
            "veritrail-core-scanner.yaml",
        ),
        "param_RemediationTemplateURL": connector_child_template_url(
            RECOMMENDED_CONNECTOR_VERSION,
            "veritrail-remediation-ssm.yaml",
        ),
        "param_EnableAdvancedPolicyGeneration": _yes_no(enable_advanced_policy_generation),
    }
    for spec in REMEDIATION_MODULES:
        params[f"param_{spec.cfn_parameter}"] = _yes_no(remediation_modules.get(spec.id, False))
    return params


def _launch_url(
    external_id: str,
    *,
    stack_name: str,
    enable_advanced_policy_generation: bool,
    remediation_modules: dict[str, bool],
) -> str:
    params = _cfn_stack_params(
        external_id,
        stack_name=stack_name,
        enable_advanced_policy_generation=enable_advanced_policy_generation,
        remediation_modules=remediation_modules,
    )
    qs = "&".join(f"{k}={quote(v, safe='')}" for k, v in params.items())
    return f"{_cfn_console_base_url()}#/stacks/create/review?{qs}"


def _update_launch_url(
    external_id: str,
    *,
    stack_name: str,
    enable_advanced_policy_generation: bool,
    remediation_modules: dict[str, bool],
) -> str:
    # AWS documents quick-create links for create/review only. Update wizard URLs drop stackName.
    _ = (external_id, enable_advanced_policy_generation, remediation_modules)
    return _cfn_stack_list_url(stack_name)


def _cli_command(
    external_id: str,
    *,
    stack_name: str,
    enable_advanced_policy_generation: bool,
    remediation_modules: dict[str, bool],
) -> str:
    from app.services.cfn_versions import RECOMMENDED_CONNECTOR_VERSION, connector_child_template_url

    s = get_settings()
    region = s.CFN_CONSOLE_REGION or "us-east-1"
    lines = [
        f"aws cloudformation create-stack --region {region} \\",
        f"  --stack-name {stack_name} \\",
        f"  --template-url {s.CFN_TEMPLATE_URL} \\",
        "  --parameters \\",
        f"    ParameterKey=ExternalId,ParameterValue={external_id} \\",
        f"    ParameterKey=VeritrailAccountPrincipal,ParameterValue={s.TRUST_PRINCIPAL_ARN} \\",
        f"    ParameterKey=RoleName,ParameterValue={s.CFN_SCANNER_ROLE_NAME} \\",
        f"    ParameterKey=CoreScannerTemplateURL,ParameterValue={connector_child_template_url(RECOMMENDED_CONNECTOR_VERSION, 'veritrail-core-scanner.yaml')} \\",
        f"    ParameterKey=RemediationTemplateURL,ParameterValue={connector_child_template_url(RECOMMENDED_CONNECTOR_VERSION, 'veritrail-remediation-ssm.yaml')} \\",
        f"    ParameterKey=EnableAdvancedPolicyGeneration,ParameterValue={_yes_no(enable_advanced_policy_generation)} \\",
    ]
    for spec in REMEDIATION_MODULES:
        lines.append(
            f"    ParameterKey={spec.cfn_parameter},ParameterValue={_yes_no(remediation_modules.get(spec.id, False))} \\"
        )
    lines.append("  --capabilities CAPABILITY_NAMED_IAM")
    return "\n".join(lines)


def _update_cli_command(
    external_id: str,
    *,
    stack_name: str,
    enable_advanced_policy_generation: bool,
    remediation_modules: dict[str, bool],
) -> str:
    from app.services.cfn_versions import RECOMMENDED_CONNECTOR_VERSION, update_cli_command

    return update_cli_command(
        external_id=external_id,
        stack_name=stack_name,
        version_tag=RECOMMENDED_CONNECTOR_VERSION,
        enable_advanced_policy_generation=enable_advanced_policy_generation,
        remediation_modules=remediation_modules,
    )


def _remediation_launch_url() -> str:
    params = {
        "templateURL": get_settings().CFN_REMEDIATION_SSM_TEMPLATE_URL,
        "stackName": "VeritrailRemediationSSM",
    }
    qs = "&".join(f"{k}={quote(v, safe='')}" for k, v in params.items())
    return f"{_cfn_console_base_url()}#/stacks/create/review?{qs}"


def _remediation_update_launch_url(stack_name: str) -> str:
    """Nested remediation child stack (only if deployed standalone). Prefer parent stack update."""
    return _cfn_stack_list_url(stack_name.strip() or "VeritrailRemediationSSM")


def _remediation_cli_command() -> str:
    return (
        "aws cloudformation create-stack \
"
        "  --stack-name VeritrailRemediationSSM \
"
        f"  --template-url {get_settings().CFN_REMEDIATION_SSM_TEMPLATE_URL} \
"
        "  --capabilities CAPABILITY_NAMED_IAM"
    )


def _create_stack_name() -> str:
    """Launch/create URLs and CLI always target the current connector stack."""
    return settings.CFN_STACK_NAME


def _update_stack_name(acc: AwsAccount) -> str:
    """Update URLs and CLI target the stack already deployed in the account."""
    return acc.cfn_stack_name


def _display_cfn_stack_name(acc: AwsAccount) -> str:
    """UI label: pending legacy rows show current name; connected legacy keeps VeritrailReadOnly."""
    if acc.status != "connected" and acc.cfn_stack_name == settings.CFN_STACK_NAME_LEGACY:
        return settings.CFN_STACK_NAME
    return acc.cfn_stack_name


def _account_out(acc: AwsAccount) -> AccountOut:
    modules = remediation_modules_dict(acc)
    option_kwargs = dict(
        enable_advanced_policy_generation=acc.enable_advanced_policy_generation,
        remediation_modules=modules,
    )
    create_opts = dict(stack_name=_create_stack_name(), **option_kwargs)
    update_opts = dict(stack_name=_update_stack_name(acc), **option_kwargs)
    return AccountOut(
        id=str(acc.id),
        label=acc.label,
        account_id=acc.account_id,
        status=acc.status,
        external_id=acc.external_id,
        role_arn=acc.role_arn if acc.role_arn and (acc.status == "connected" or acc.account_id) else None,
        last_error=acc.last_error,
        enable_advanced_policy_generation=acc.enable_advanced_policy_generation,
        remediation_modules=_remediation_modules_in(modules),
        remediation_modules_deployed=_remediation_modules_in(remediation_deployed_dict(acc)),
        advanced_policy_generation_deployed=acc.advanced_policy_generation_deployed,
        cfn_stack_name=_display_cfn_stack_name(acc),
        cfn_launch_url=_launch_url(acc.external_id, **create_opts),
        cfn_update_launch_url=_update_launch_url(acc.external_id, **update_opts),
        cfn_template_url=get_settings().CFN_TEMPLATE_URL,
        cfn_cli_command=_cli_command(acc.external_id, **create_opts),
        cfn_update_cli_command=_update_cli_command(acc.external_id, **update_opts),
        remediation_cfn_launch_url=_remediation_launch_url() if any_remediation_enabled(modules) else None,
        remediation_cfn_template_url=get_settings().CFN_REMEDIATION_SSM_TEMPLATE_URL,
        remediation_cfn_cli_command=_remediation_cli_command() if any_remediation_enabled(modules) else None,
        cfn_template_version=get_settings().CFN_TEMPLATE_VERSION,
        last_scan_at=acc.last_scan_at,
        cloudtrail_onboarding_mode=(
            acc.cloudtrail_onboarding_mode
            if isinstance(getattr(acc, "cloudtrail_onboarding_mode", None), (str, type(None)))
            else None
        ),
    )


def _heal_established_account_after_failed_reverify(acc: AwsAccount) -> bool:
    """Older clients set status=error on failed role update even when the good role_arn was kept."""
    if acc.status == "error" and acc.account_id and acc.role_arn:
        acc.status = "connected"
        return True
    return False


@router.post("", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def create_account(body: AccountIn, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org_id = uuid.UUID(p["org_id"])
    org = db.get(Org, org_id)
    if not org:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session expired — please sign in again")
    limit = plan_account_limit(org.plan)
    if limit is not None:
        used = _org_connected_account_count(db, org_id)
        if used >= limit:
            tier = get_plan(org.plan)
            raise HTTPException(
                status.HTTP_402_PAYMENT_REQUIRED,
                detail=(
                    f"Your {tier.label} plan includes {limit} connected "
                    f"account{'s' if limit != 1 else ''}. Upgrade to connect more."
                ),
            )
    ext = secrets.token_urlsafe(24)
    acc = AwsAccount(
        id=uuid.uuid4(),
        org_id=uuid.UUID(p["org_id"]),
        label=body.label,
        external_id=ext,
        cfn_stack_name=settings.CFN_STACK_NAME,
        enable_advanced_policy_generation=body.enable_advanced_policy_generation,
    )
    set_remediation_modules(acc, _modules_from_body(body.remediation_modules))
    db.add(acc)
    log_org_activity(
        db,
        org_id=uuid.UUID(p["org_id"]),
        actor_user_id=uuid.UUID(p["sub"]) if p.get("sub") else None,
        action="account.created",
        target_type="aws_account",
        target_id=str(acc.id),
        target_label=acc.label,
    )
    db.commit()
    return _account_out(acc)


@router.patch("/{account_id}/connection-options", response_model=AccountOut)
def update_connection_options(
    account_id: str,
    body: ConnectionOptionsIn,
    _rbac: RequireAdmin, p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    acc = db.get(AwsAccount, uuid.UUID(account_id))
    if not acc or str(acc.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    incoming = _modules_from_body(body.remediation_modules)
    current = remediation_modules_dict(acc)
    if (
        acc.enable_advanced_policy_generation
        and not body.enable_advanced_policy_generation
        and acc.advanced_policy_generation_deployed
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Advanced IAM policy generation is verified in your deployed role. "
            "Update your CloudFormation stack with EnableAdvancedPolicyGeneration=No, "
            "run Verify permissions, then turn this off in Veritrail.",
        )
    for spec in REMEDIATION_MODULES:
        if (
            current.get(spec.id)
            and not incoming.get(spec.id)
            and getattr(acc, spec.deployed_column)
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{spec.label} remediation is verified in your deployed role. "
                f"Update your stack with {spec.cfn_parameter}=No, verify, then disable in Veritrail.",
            )
    if body.enable_advanced_policy_generation != acc.enable_advanced_policy_generation:
        acc.advanced_policy_generation_deployed = False
    for spec in REMEDIATION_MODULES:
        if incoming.get(spec.id) != current.get(spec.id):
            setattr(acc, spec.deployed_column, False)
    acc.enable_advanced_policy_generation = body.enable_advanced_policy_generation
    set_remediation_modules(acc, incoming)
    log_org_activity(
        db,
        org_id=uuid.UUID(p["org_id"]),
        actor_user_id=uuid.UUID(p["sub"]) if p.get("sub") else None,
        action="account.capabilities_updated",
        target_type="aws_account",
        target_id=str(acc.id),
        target_label=acc.label,
        detail={
            "advanced_policy_generation": body.enable_advanced_policy_generation,
            "remediation_modules": {k: v for k, v in incoming.items() if v},
        },
    )
    db.commit()
    return _account_out(acc)


@router.get("", response_model=list[AccountOut])
def list_accounts(p=Depends(current_principal), db: Session = Depends(get_db)):
    rows = db.scalars(select(AwsAccount).where(AwsAccount.org_id == uuid.UUID(p["org_id"]))).all()
    if any(_heal_established_account_after_failed_reverify(a) for a in rows):
        db.commit()
    return [_account_out(a) for a in rows]


class PlanUsageOut(BaseModel):
    plan: str
    plan_label: str
    max_accounts: int | None  # null = unlimited
    used: int
    can_add: bool


def _org_connected_account_count(db: Session, org_id: uuid.UUID) -> int:
    """Connected cloud accounts across AWS, GCP, and Azure (plan-cap enforcement)."""
    connected = "connected"
    aws = (
        db.scalar(
            select(func.count())
            .select_from(AwsAccount)
            .where(AwsAccount.org_id == org_id, AwsAccount.status == connected)
        )
        or 0
    )
    gcp = (
        db.scalar(
            select(func.count())
            .select_from(GcpProject)
            .where(GcpProject.org_id == org_id, GcpProject.status == connected)
        )
        or 0
    )
    azure = (
        db.scalar(
            select(func.count())
            .select_from(AzureSubscription)
            .where(AzureSubscription.org_id == org_id, AzureSubscription.status == connected)
        )
        or 0
    )
    return aws + gcp + azure


@router.get("/plan-usage", response_model=PlanUsageOut)
def plan_usage(p=Depends(current_principal), db: Session = Depends(get_db)):
    org_id = uuid.UUID(p["org_id"])
    org = db.get(Org, org_id)
    tier = get_plan(org.plan if org else None)
    used = _org_connected_account_count(db, org_id)
    limit = plan_account_limit(org.plan if org else None)
    return PlanUsageOut(
        plan=tier.slug,
        plan_label=tier.label,
        max_accounts=limit,
        used=used,
        can_add=limit is None or used < limit,
    )


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: str, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    acc = db.get(AwsAccount, uuid.UUID(account_id))
    if not acc or str(acc.org_id) != p["org_id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    log_org_activity(
        db,
        org_id=uuid.UUID(p["org_id"]),
        actor_user_id=uuid.UUID(p["sub"]) if p.get("sub") else None,
        action="account.removed",
        target_type="aws_account",
        target_id=str(acc.id),
        target_label=acc.label,
        detail={"aws_account_id": acc.account_id},
    )
    db.delete(acc)
    db.commit()
