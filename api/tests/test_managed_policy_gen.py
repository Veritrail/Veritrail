"""Tests for managed policy generation (_clean_managed_policies and generate_role_policy integration)."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

from app.routes.accounts_analysis import (
    _build_policy_doc_from_statements,
    _clean_managed_policies,
)


# ── _build_policy_doc_from_statements ──────────────────────────────

def test_build_policy_doc_wraps_statements():
    statements = [
        {"Effect": "Allow", "Action": "s3:GetObject", "Resource": "*"},
    ]
    doc = _build_policy_doc_from_statements(statements)

    assert doc["Version"] == "2012-10-17"
    assert doc["Statement"] == statements
    # Should be a deep copy — modifying input doesn't affect output
    statements[0]["Action"] = "s3:*"
    assert doc["Statement"][0]["Action"] == "s3:GetObject"


def test_build_policy_doc_empty_statements():
    doc = _build_policy_doc_from_statements([])
    assert doc["Version"] == "2012-10-17"
    assert doc["Statement"] == []


# ── _clean_managed_policies ────────────────────────────────────────

def test_clean_single_customer_managed_policy_wildcard_narrowed():
    """Customer-managed policy with wildcard narrowed to used actions."""
    attached = [{
        "policy_arn": "arn:aws:iam::123456789012:policy/TestPolicy",
        "policy_name": "TestPolicy",
        "policy_type": "customer_managed",
        "statements": [
            {"Effect": "Allow", "Action": "*", "Resource": "*"},
        ],
    }]
    unused = {"s3", "ec2", "lambda"}
    used = {"iam", "sts"}
    used_actions = ["iam:ListRoles", "sts:AssumeRole"]

    result = _clean_managed_policies(attached, unused, used, used_actions)

    assert result["TestPolicy"]["statements_removed"] == 0
    assert result["TestPolicy"]["statements_modified"] == 1
    assert result["TestPolicy"]["policy_type"] == "customer_managed"
    assert result["TestPolicy"]["policy_arn"] == "arn:aws:iam::123456789012:policy/TestPolicy"
    assert set(result["TestPolicy"]["cleaned_statements"][0]["Action"]) == {"iam:ListRoles", "sts:AssumeRole"}
    assert result["_summary"]["total_statements_removed"] == 0
    assert result["_summary"]["total_statements_modified"] == 1
    assert result["_summary"]["total_policies"] == 1


def test_clean_aws_managed_policy_unused_service_removed():
    """AWS-managed policy — still cleans but marks as aws_managed."""
    attached = [{
        "policy_arn": "arn:aws:iam::aws:policy/ReadOnlyAccess",
        "policy_name": "ReadOnlyAccess",
        "policy_type": "aws_managed",
        "statements": [
            {"Effect": "Allow", "Action": "s3:*", "Resource": "*"},
        ],
    }]
    unused = {"s3"}
    used = {"iam"}
    used_actions = ["iam:ListRoles"]

    result = _clean_managed_policies(attached, unused, used, used_actions)

    assert result["ReadOnlyAccess"]["policy_type"] == "aws_managed"
    assert result["ReadOnlyAccess"]["statements_removed"] == 1  # s3:* fully removed
    assert result["ReadOnlyAccess"]["cleaned_statements"] == []
    assert result["_summary"]["total_statements_removed"] == 1


def test_clean_multiple_managed_policies():
    """Multiple managed policies cleaned independently, summary aggregates."""
    attached = [
        {
            "policy_arn": "arn:aws:iam::123456789012:policy/PolicyA",
            "policy_name": "PolicyA",
            "policy_type": "customer_managed",
            "statements": [
                {"Effect": "Allow", "Action": "s3:*", "Resource": "*"},
            ],
        },
        {
            "policy_arn": "arn:aws:iam::123456789012:policy/PolicyB",
            "policy_name": "PolicyB",
            "policy_type": "customer_managed",
            "statements": [
                {"Effect": "Allow", "Action": ["ec2:Describe*", "iam:ListRoles"], "Resource": "*"},
            ],
        },
    ]
    unused = {"s3"}
    used = {"ec2"}
    used_actions = ["ec2:DescribeInstances", "iam:ListRoles"]

    result = _clean_managed_policies(attached, unused, used, used_actions)

    assert result["PolicyA"]["statements_removed"] == 1  # s3:* completely removed
    assert result["PolicyB"]["statements_modified"] >= 1  # ec2:Describe* narrowed
    assert result["_summary"]["total_policies"] == 2
    assert result["_summary"]["total_statements_removed"] == 1


def test_clean_managed_with_deny_statements_preserved():
    """Deny statements should be preserved unchanged."""
    attached = [{
        "policy_arn": "arn:aws:iam::123456789012:policy/WithDeny",
        "policy_name": "WithDeny",
        "policy_type": "customer_managed",
        "statements": [
            {"Effect": "Allow", "Action": "s3:*", "Resource": "*"},
            {"Effect": "Deny", "Action": "s3:DeleteBucket", "Resource": "*"},
        ],
    }]
    unused = {"s3"}
    used = {"iam"}
    used_actions = ["iam:ListRoles"]

    result = _clean_managed_policies(attached, unused, used, used_actions)

    # Allow statement for s3:* should be removed (unused service)
    # Deny statement should be preserved
    cleaned = result["WithDeny"]["cleaned_statements"]
    assert len(cleaned) == 1
    assert cleaned[0]["Effect"] == "Deny"
    assert cleaned[0]["Action"] == "s3:DeleteBucket"


def test_clean_managed_with_aa_resources():
    """CloudTrail resource ARNs applied to cleaned managed policy."""
    attached = [{
        "policy_arn": "arn:aws:iam::123456789012:policy/DynamoPolicy",
        "policy_name": "DynamoPolicy",
        "policy_type": "customer_managed",
        "statements": [
            {"Effect": "Allow", "Action": ["dynamodb:GetItem", "dynamodb:PutItem"], "Resource": "*"},
        ],
    }]
    aa_statements = [{
        "actions": ["dynamodb:GetItem", "dynamodb:PutItem"],
        "resources": ["arn:aws:dynamodb:us-east-1:123456789012:table/orders"],
        "placeholder_resources": [],
    }]

    result = _clean_managed_policies(attached, set(), set(), [], aa_statements)

    # Resource should be scoped to the specific table
    stmts = result["DynamoPolicy"]["cleaned_statements"]
    assert stmts[0]["Resource"] == "arn:aws:dynamodb:us-east-1:123456789012:table/orders"


def test_empty_managed_policies():
    """Empty list returns empty result."""
    result = _clean_managed_policies([], set(), set(), [])
    assert result["_summary"]["total_policies"] == 0
    assert result["_summary"]["total_statements_removed"] == 0
    assert result["_summary"]["total_statements_modified"] == 0


def test_clean_managed_policy_no_statements_field():
    """Policy with missing statements field defaults to empty."""
    attached = [{
        "policy_arn": "arn:aws:iam::123456789012:policy/Empty",
        "policy_name": "Empty",
        "policy_type": "customer_managed",
    }]
    result = _clean_managed_policies(attached, set(), set(), [])

    assert result["Empty"]["original_statements"] == []
    assert result["Empty"]["cleaned_statements"] == []
    assert result["Empty"]["statements_removed"] == 0


# ── generate_role_policy integration ───────────────────────────────

@patch("app.routes.accounts_analysis._resolve_advanced_policy_generation")
def test_generate_role_policy_with_only_managed(mock_resolve):
    """Role with only managed policies → has_managed_policies=True, has_inline_policies=False."""
    from app.routes.accounts_analysis import generate_role_policy

    mock_resolve.return_value = {"available": False, "reason": "no_generation", "note": "none"}

    acc = MagicMock()
    acc.id = uuid.uuid4()
    acc.org_id = uuid.uuid4()
    acc.enable_advanced_policy_generation = False
    acc.advanced_policy_generation_deployed = False
    acc.role_arn = "arn:aws:iam::123456789012:role/TestRole"
    acc.external_id = "ext"

    role = MagicMock()
    role.inline_policies = {}
    role.attached_policies = [
        {
            "policy_arn": "arn:aws:iam::123456789012:policy/MyManagedPolicy",
            "policy_name": "MyManagedPolicy",
            "policy_type": "customer_managed",
            "statements": [
                {"Effect": "Allow", "Action": "iam:*", "Resource": "*"},
            ],
        },
    ]

    db = MagicMock()
    db.get.return_value = acc
    db.scalar.return_value = role
    db.scalars.return_value.all.return_value = []

    # Mock IamPermUsage with some usage data
    usage = MagicMock()
    usage.service = "iam"
    usage.actions_json = ["iam:ListRoles", "iam:GetRole"]
    usage.last_accessed = __import__("datetime").datetime(2026, 5, 15, tzinfo=__import__("datetime").timezone.utc)
    usage.last_authenticated = usage.last_accessed  # Not None → service is "used"
    db.scalars.side_effect = [MagicMock(all=MagicMock(return_value=[usage])), MagicMock(all=MagicMock(return_value=[]))]

    principal = {"org_id": str(acc.org_id)}

    result = generate_role_policy(
        account_id=str(acc.id),
        role_arn="arn:aws:iam::123456789012:role/TestRole",
        threshold_days=90,
        advanced=False,
        p=principal,
        db=db,
    )

    assert result["has_inline_policies"] is False
    assert result["has_managed_policies"] is True
    assert result["original_policies"] is None
    assert result["cleaned_policies"] is None
    assert result["managed_policies"] is not None
    assert "MyManagedPolicy" in result["managed_policies"]
    assert result["managed_policies_summary"]["total"] == 1
    assert result["managed_policies_summary"]["customer_managed"] == 1
    assert result["managed_policies_summary"]["aws_managed"] == 0
    assert result["note"] is None  # Should be None when policies exist


@patch("app.routes.accounts_analysis._resolve_advanced_policy_generation")
def test_generate_role_policy_with_both_inline_and_managed(mock_resolve):
    """Role with both inline and managed policies → both sections present."""
    from app.routes.accounts_analysis import generate_role_policy

    mock_resolve.return_value = {"available": False, "reason": "no_generation", "note": "none"}

    acc = MagicMock()
    acc.id = uuid.uuid4()
    acc.org_id = uuid.uuid4()
    acc.enable_advanced_policy_generation = False
    acc.advanced_policy_generation_deployed = False
    acc.role_arn = "arn:aws:iam::123456789012:role/TestRole"
    acc.external_id = "ext"

    role = MagicMock()
    role.inline_policies = {
        "InlinePolicyA": {
            "Version": "2012-10-17",
            "Statement": [{"Effect": "Allow", "Action": "ec2:Describe*", "Resource": "*"}],
        },
    }
    role.attached_policies = [
        {
            "policy_arn": "arn:aws:iam::123456789012:policy/ManagedB",
            "policy_name": "ManagedB",
            "policy_type": "customer_managed",
            "statements": [
                {"Effect": "Allow", "Action": "iam:*", "Resource": "*"},
            ],
        },
    ]

    db = MagicMock()
    db.get.return_value = acc
    db.scalar.return_value = role
    db.scalars.return_value.all.return_value = []

    usage = MagicMock()
    usage.service = "iam"
    usage.actions_json = ["iam:ListRoles"]
    usage.last_accessed = __import__("datetime").datetime(2026, 5, 15, tzinfo=__import__("datetime").timezone.utc)
    usage.last_authenticated = usage.last_accessed
    db.scalars.side_effect = [MagicMock(all=MagicMock(return_value=[usage])), MagicMock(all=MagicMock(return_value=[]))]

    principal = {"org_id": str(acc.org_id)}

    result = generate_role_policy(
        account_id=str(acc.id),
        role_arn="arn:aws:iam::123456789012:role/TestRole",
        threshold_days=90,
        advanced=False,
        p=principal,
        db=db,
    )

    assert result["has_inline_policies"] is True
    assert result["has_managed_policies"] is True
    assert result["original_policies"] is not None
    assert result["cleaned_policies"] is not None
    assert result["managed_policies"] is not None
    assert "InlinePolicyA" in result["cleaned_policies"]
    assert "ManagedB" in result["managed_policies"]


@patch("app.routes.accounts_analysis._resolve_advanced_policy_generation")
def test_generate_role_policy_with_neither(mock_resolve):
    """Role with no inline and no managed policies → both false, note present."""
    from app.routes.accounts_analysis import generate_role_policy

    mock_resolve.return_value = {"available": False, "reason": "no_generation", "note": "none"}

    acc = MagicMock()
    acc.id = uuid.uuid4()
    acc.org_id = uuid.uuid4()
    acc.enable_advanced_policy_generation = False
    acc.advanced_policy_generation_deployed = False
    acc.role_arn = "arn:aws:iam::123456789012:role/TestRole"
    acc.external_id = "ext"

    role = MagicMock()
    role.inline_policies = {}
    role.attached_policies = []

    db = MagicMock()
    db.get.return_value = acc
    db.scalar.return_value = role
    db.scalars.return_value.all.return_value = []

    principal = {"org_id": str(acc.org_id)}

    result = generate_role_policy(
        account_id=str(acc.id),
        role_arn="arn:aws:iam::123456789012:role/TestRole",
        threshold_days=90,
        advanced=False,
        p=principal,
        db=db,
    )

    assert result["has_inline_policies"] is False
    assert result["has_managed_policies"] is False
    assert result["note"] is not None
    assert "no inline policies" in result["note"]


@patch("app.routes.accounts_analysis._resolve_advanced_policy_generation")
def test_generate_role_policy_managed_summary_counts_types(mock_resolve):
    """Managed summary correctly counts customer_managed vs aws_managed policies."""
    from app.routes.accounts_analysis import generate_role_policy

    mock_resolve.return_value = {"available": False, "reason": "no_generation", "note": "none"}

    acc = MagicMock()
    acc.id = uuid.uuid4()
    acc.org_id = uuid.uuid4()
    acc.enable_advanced_policy_generation = False
    acc.advanced_policy_generation_deployed = False
    acc.role_arn = "arn:aws:iam::123456789012:role/TestRole"
    acc.external_id = "ext"

    role = MagicMock()
    role.inline_policies = {}
    role.attached_policies = [
        {
            "policy_arn": "arn:aws:iam::123456789012:policy/Custom1",
            "policy_name": "Custom1",
            "policy_type": "customer_managed",
            "statements": [{"Effect": "Allow", "Action": "iam:*", "Resource": "*"}],
        },
        {
            "policy_arn": "arn:aws:iam::aws:policy/AdministratorAccess",
            "policy_name": "AdministratorAccess",
            "policy_type": "aws_managed",
            "statements": [{"Effect": "Allow", "Action": "*", "Resource": "*"}],
        },
        {
            "policy_arn": "arn:aws:iam::123456789012:policy/Custom2",
            "policy_name": "Custom2",
            "policy_type": "customer_managed",
            "statements": [{"Effect": "Allow", "Action": "s3:*", "Resource": "*"}],
        },
    ]

    db = MagicMock()
    db.get.return_value = acc
    db.scalar.return_value = role
    db.scalars.return_value.all.return_value = []

    usage = MagicMock()
    usage.service = "iam"
    usage.actions_json = ["iam:ListRoles"]
    usage.last_accessed = __import__("datetime").datetime(2026, 5, 15, tzinfo=__import__("datetime").timezone.utc)
    usage.last_authenticated = usage.last_accessed
    db.scalars.side_effect = [MagicMock(all=MagicMock(return_value=[usage])), MagicMock(all=MagicMock(return_value=[]))]

    principal = {"org_id": str(acc.org_id)}

    result = generate_role_policy(
        account_id=str(acc.id),
        role_arn="arn:aws:iam::123456789012:role/TestRole",
        threshold_days=90,
        advanced=False,
        p=principal,
        db=db,
    )

    assert result["has_managed_policies"] is True
    summary = result["managed_policies_summary"]
    assert summary["total"] == 3
    assert summary["customer_managed"] == 2
    assert summary["aws_managed"] == 1
    # AdministratorAccess (*) gets modified (narrowed to iam:*), s3:* gets removed
    assert summary["statements_removed"] >= 1  # s3:* removed
    assert summary["statements_modified"] >= 1  # AdministratorAccess * narrowed
