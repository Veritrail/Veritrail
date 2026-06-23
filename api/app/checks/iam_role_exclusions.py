"""Skip rules for IAM roles that AWS manages or that have unreliable usage signals."""
from __future__ import annotations

_SSO_RESERVED_PATH = "/aws-reserved/sso.amazonaws.com/"
_SERVICE_LINKED_PATH = "/aws-service-role/"
_SSO_NAME_PREFIX = "AWSReservedSSO_"


def is_service_linked_role(arn: str) -> bool:
    return _SERVICE_LINKED_PATH in arn


def is_sso_reserved_role(arn: str, name: str | None = None) -> bool:
    """IAM Identity Center permission-set roles.

    Names: AWSReservedSSO_<PermissionSet>_<hash>
    Path:  .../role/aws-reserved/sso.amazonaws.com/...

    RoleLastUsed often stays empty even when people sign in via Identity Center,
    so operational checks (e.g. unassumed 90d) must not flag these.
    """
    if name and name.startswith(_SSO_NAME_PREFIX):
        return True
    return _SSO_RESERVED_PATH in arn


def is_operational_check_excluded_role(arn: str, name: str | None = None) -> bool:
    """Roles to skip for usage/orphan hygiene checks."""
    return is_service_linked_role(arn) or is_sso_reserved_role(arn, name)


def is_veritrail_integration_role(name: str | None) -> bool:
    """Cross-account trust to Veritrail's control-plane principal is required for scanning."""
    if not name:
        return False
    return name == "VeritrailReadOnly" or name.startswith("Veritrail")
