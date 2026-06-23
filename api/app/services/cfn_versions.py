from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote

from app.core.config import get_settings
from app.data.remediation_modules import REMEDIATION_MODULES


@dataclass(frozen=True)
class ConnectorVersion:
    tag: str
    label: str
    status: str
    notes: str


CONNECTOR_VERSIONS: tuple[ConnectorVersion, ...] = (
    ConnectorVersion(
        tag="2026.06",
        label="CFN v2026.06",
        status="recommended",
        notes="Recommended connector release with current remediation and SSM document updates.",
    ),
)

RECOMMENDED_CONNECTOR_VERSION = "2026.06"

_ALLOWED_TAGS = frozenset(v.tag for v in CONNECTOR_VERSIONS)


def validate_connector_version_tag(tag: str) -> str:
    if tag not in _ALLOWED_TAGS:
        raise ValueError(f"unsupported connector version: {tag}")
    return tag


def allowed_connector_versions() -> list[dict]:
    return [
        {
            "tag": v.tag,
            "label": v.label,
            "status": v.status,
            "notes": v.notes,
            "template_url": connector_template_url(v.tag),
        }
        for v in CONNECTOR_VERSIONS
    ]


def connector_template_url(tag: str) -> str:
    validate_connector_version_tag(tag)

    settings = get_settings()
    region = settings.CFN_CONSOLE_REGION or "us-east-1"

    base_url = settings.CFN_TEMPLATE_URL
    marker = "/infra/"
    if marker in base_url:
        root = base_url.split(marker, 1)[0]
        return f"{root}/infra/{tag}/veritrail-stack.yaml"

    return f"https://amzn-s3-veritrail.s3.{region}.amazonaws.com/infra/{tag}/veritrail-stack.yaml"


def _yes_no(flag: bool) -> str:
    return "Yes" if flag else "No"


def cfn_console_base_url() -> str:
    region = get_settings().CFN_CONSOLE_REGION or "us-east-1"
    return f"https://console.aws.amazon.com/cloudformation/home?region={region}"


def cloudformation_stack_url(stack_name: str) -> str:
    name = stack_name.strip() or get_settings().CFN_STACK_NAME
    return (
        f"{cfn_console_base_url()}#/stacks"
        f"?filteringText={quote(name, safe='')}&filteringStatus=active"
    )


def update_cli_command(
    *,
    external_id: str,
    stack_name: str,
    version_tag: str,
    enable_advanced_policy_generation: bool,
    remediation_modules: dict[str, bool],
) -> str:
    settings = get_settings()
    region = settings.CFN_CONSOLE_REGION or "us-east-1"
    template_url = connector_template_url(version_tag)

    lines = [
        f"aws cloudformation update-stack --region {region} \\",
        f"  --stack-name {stack_name.strip() or settings.CFN_STACK_NAME} \\",
        f"  --template-url {template_url} \\",
        "  --parameters \\",
        f"    ParameterKey=ExternalId,ParameterValue={external_id} \\",
        f"    ParameterKey=VeritrailAccountPrincipal,ParameterValue={settings.TRUST_PRINCIPAL_ARN} \\",
        f"    ParameterKey=RoleName,ParameterValue={settings.CFN_SCANNER_ROLE_NAME} \\",
        f"    ParameterKey=EnableAdvancedPolicyGeneration,ParameterValue={_yes_no(enable_advanced_policy_generation)} \\",
    ]

    for spec in REMEDIATION_MODULES:
        lines.append(
            f"    ParameterKey={spec.cfn_parameter},ParameterValue={_yes_no(remediation_modules.get(spec.id, False))} \\"
        )

    lines.append("  --capabilities CAPABILITY_NAMED_IAM")
    return "\n".join(lines)
