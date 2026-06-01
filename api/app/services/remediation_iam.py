"""IAM policy fragments for customer remediation automation (per check family).

All statements are scoped to the minimum resource possible. When a resource_arn
is provided, mutating actions are scoped to that ARN. Describe/List operations
that have no resource-level permissions keep Resource: "*" as required by AWS IAM.
"""
from __future__ import annotations

from typing import Any


def inline_policy_for_check(check_id: str, *, resource_arn: str | None = None) -> list[dict[str, Any]]:
    """Least-privilege statements for the given finding check (customer role inline policy).

    When resource_arn is provided, mutating actions are scoped to that specific
    resource. Describe/List operations keep Resource: "*" where AWS requires it.
    """
    if check_id == "s3.bucket.public_access_not_blocked":
        bucket_arn = _s3_bucket_arn(resource_arn)
        return [
            {
                "Sid": "S3PublicAccessBlock",
                "Effect": "Allow",
                "Action": ["s3:PutBucketPublicAccessBlock", "s3:GetPublicAccessBlock"],
                "Resource": bucket_arn if bucket_arn else "arn:aws:s3:::*",
            },
        ]
    if check_id.startswith("s3."):
        return [
            {
                "Sid": "S3Default",
                "Effect": "Allow",
                "Action": ["s3:GetBucketPublicAccessBlock", "s3:GetBucketLocation"],
                "Resource": _s3_bucket_arn(resource_arn) or "arn:aws:s3:::*",
            },
        ]
    if check_id.startswith("ec2.security_group"):
        sg_arn = _security_group_arn(resource_arn)
        return [
            {
                "Sid": "Ec2SecurityGroupIngress",
                "Effect": "Allow",
                "Action": [
                    "ec2:RevokeSecurityGroupIngress",
                ],
                "Resource": sg_arn if sg_arn else "*",
            },
            {
                "Sid": "Ec2SecurityGroupDescribe",
                "Effect": "Allow",
                "Action": [
                    "ec2:DescribeSecurityGroups",
                    "ec2:DescribeSecurityGroupRules",
                ],
                "Resource": "*",  # Describe* operations require Resource: "*"
            },
        ]
    if check_id.startswith("kms."):
        kms_arn = _kms_key_arn(resource_arn)
        return [
            {
                "Sid": "KmsKeyPolicy",
                "Effect": "Allow",
                "Action": ["kms:GetKeyPolicy", "kms:PutKeyPolicy", "kms:EnableKeyRotation"],
                "Resource": kms_arn if kms_arn else "*",
            },
        ]
    if check_id.startswith("ssm."):
        param_arn = _ssm_parameter_arn_from_resource(resource_arn)
        return [
            {
                "Sid": "SsmParameterSecureStringMigration",
                "Effect": "Allow",
                "Action": ["ssm:GetParameter", "ssm:PutParameter"],
                "Resource": param_arn if param_arn else "*",
            }
        ]
    if check_id in (
        "iam.access_key.unused_45d",
        "iam.access_key.unused_90d",
    ):
        user_arn = _iam_user_arn(resource_arn)
        key_arn = _access_key_arn(resource_arn)
        statements: list[dict[str, Any]] = [
            {
                "Sid": "IamAccessKeyDeactivate",
                "Effect": "Allow",
                "Action": ["iam:UpdateAccessKey"],
                "Resource": key_arn if key_arn else "*",
            },
        ]
        if user_arn:
            statements.append({
                "Sid": "IamAccessKeyRead",
                "Effect": "Allow",
                "Action": ["iam:GetAccessKeyLastUsed"],
                "Resource": key_arn if key_arn else "*",
            })
        else:
            statements.append({
                "Sid": "IamAccessKeyRead",
                "Effect": "Allow",
                "Action": ["iam:GetAccessKeyLastUsed"],
                "Resource": "*",
            })
        return statements
    if check_id == "iam.role.full_admin_policy":
        role_arn = _iam_role_arn(resource_arn)
        return [
            {
                "Sid": "IamDetachFullAdmin",
                "Effect": "Allow",
                "Action": [
                    "iam:DetachRolePolicy",
                ],
                "Resource": role_arn if role_arn else "*",
            },
            {
                "Sid": "IamRoleRead",
                "Effect": "Allow",
                "Action": [
                    "iam:ListAttachedRolePolicies",
                    "iam:GetRole",
                    "iam:GetPolicy",
                ],
                "Resource": "*",  # GetPolicy needs policy ARN (unknown at plan time); ListAttached needs role ARN
            },
        ]
    if check_id == "iam.policy.wildcard_resource":
        role_arn = _iam_role_arn(resource_arn)
        return [
            {
                "Sid": "IamReplaceWildcardInline",
                "Effect": "Allow",
                "Action": [
                    "iam:PutRolePolicy",
                ],
                "Resource": role_arn if role_arn else "*",
            },
            {
                "Sid": "IamRolePolicyRead",
                "Effect": "Allow",
                "Action": [
                    "iam:GetRolePolicy",
                    "iam:GetRole",
                ],
                "Resource": role_arn if role_arn else "*",
            },
        ]
    if check_id.startswith("cloudtrail."):
        trail_arn = _cloudtrail_trail_arn(resource_arn)
        statements = [
            {
                "Sid": "CloudTrailManagement",
                "Effect": "Allow",
                "Action": [
                    "cloudtrail:UpdateTrail",
                    "cloudtrail:StartLogging",
                ],
                "Resource": trail_arn if trail_arn else "*",
            },
            {
                "Sid": "CloudTrailDescribe",
                "Effect": "Allow",
                "Action": [
                    "cloudtrail:DescribeTrails",
                ],
                "Resource": "*",  # DescribeTrails requires Resource: "*"
            },
        ]
        if check_id == "cloudtrail.trail.not_enabled":
            statements.insert(0, {
                "Sid": "CloudTrailCreate",
                "Effect": "Allow",
                "Action": ["cloudtrail:CreateTrail"],
                "Resource": "*",  # CreateTrail cannot be scoped to an existing trail ARN
            })
            statements.append({
                "Sid": "S3CloudTrailBucket",
                "Effect": "Allow",
                "Action": ["s3:GetBucketPolicy", "s3:PutBucketPolicy"],
                "Resource": "*",  # S3 bucket ARN unknown at plan time for new trails
            })
        return statements
    if check_id.startswith("iam."):
        role_arn = _iam_role_arn(resource_arn) or _iam_user_arn(resource_arn)
        return [
            {
                "Sid": "IamRead",
                "Effect": "Allow",
                "Action": ["iam:GetRole", "iam:GetPolicy", "iam:ListAttachedRolePolicies"],
                "Resource": role_arn if role_arn else "*",
            },
        ]
    return [
        {
            "Sid": "ReadOnlyStub",
            "Effect": "Allow",
            "Action": ["iam:GetRole"],
            "Resource": "*",
        },
    ]


def inline_policy_document(check_id: str, *, resource_arn: str | None = None) -> dict[str, Any]:
    return {
        "Version": "2012-10-17",
        "Statement": inline_policy_for_check(check_id, resource_arn=resource_arn),
    }


# ── ARN extraction helpers ───────────────────────────────────────────────────


def _s3_bucket_arn(resource_arn: str | None) -> str | None:
    """Extract S3 bucket ARN from a resource ARN like arn:aws:s3:::bucket-name."""
    if not resource_arn:
        return None
    if resource_arn.startswith("arn:aws:s3:::"):
        return f"arn:aws:s3:::{resource_arn.split(':::')[-1].split('/')[0]}"
    return None


def _security_group_arn(resource_arn: str | None) -> str | None:
    """Extract security group ARN from arn:aws:ec2:region:account:security-group/sg-xxx."""
    if not resource_arn:
        return None
    if "/security-group/" in resource_arn:
        return resource_arn
    return None


def _kms_key_arn(resource_arn: str | None) -> str | None:
    """Extract KMS key ARN."""
    if not resource_arn:
        return None
    if resource_arn.startswith("arn:aws:kms:"):
        return resource_arn
    return None


def _iam_role_arn(resource_arn: str | None) -> str | None:
    """Extract IAM role ARN."""
    if not resource_arn:
        return None
    if ":role/" in resource_arn:
        return resource_arn
    return None


def _iam_user_arn(resource_arn: str | None) -> str | None:
    """Extract IAM user ARN from resource_arn (may contain #key_id suffix)."""
    if not resource_arn:
        return None
    base = resource_arn.split("#")[0] if "#" in resource_arn else resource_arn
    if ":user/" in base:
        return base
    return None


def _access_key_arn(resource_arn: str | None) -> str | None:
    """Extract access key ARN from resource_arn like arn:aws:iam::account:user/name#key_id."""
    if not resource_arn:
        return None
    parts = resource_arn.split("#")
    if len(parts) == 2 and ":user/" in parts[0]:
        user_part = parts[0]
        account = user_part.split(":")[4] if user_part.count(":") >= 5 else None
        user_name = user_part.split("/")[-1] if "/" in user_part else ""
        if account and user_name:
            return f"arn:aws:iam::{account}:user/{user_name}"
    return None


def _ssm_parameter_arn_from_resource(resource_arn: str | None) -> str | None:
    """ssm:GetParameter supports parameter-level ARN: arn:aws:ssm:region:account:parameter/name."""
    if not resource_arn:
        return None
    return resource_arn


def _cloudtrail_trail_arn(resource_arn: str | None) -> str | None:
    """Extract CloudTrail trail ARN if it's a real trail, return None for account-level findings."""
    if not resource_arn:
        return None
    if resource_arn.startswith("arn:aws:cloudtrail:") and "/trail" in resource_arn:
        # Check it's a specific trail ARN, not the placeholder
        if ":trail/" in resource_arn and resource_arn.count(":") >= 6:
            return resource_arn
    return None
