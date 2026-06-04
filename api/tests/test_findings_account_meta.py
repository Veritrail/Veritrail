"""Finding list embeds account display names (not raw AWS ids)."""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from app.routes.findings import _account_display_name, _to_out


def test_account_display_name_prefers_label_over_id():
    acc = SimpleNamespace(label="Production", account_id="123456789012")
    assert _account_display_name(acc) == "Production"


def test_account_display_name_falls_back_when_only_id():
    acc = SimpleNamespace(label="123456789012", account_id="123456789012")
    assert _account_display_name(acc) == "AWS account"


def test_to_out_includes_account_name():
    acc_id = uuid.uuid4()
    f = SimpleNamespace(
        id=uuid.uuid4(),
        account_id=acc_id,
        check_id="iam.role.admin",
        resource_arn="arn:aws:iam::123:role/x",
        title="Admin role",
        severity="high",
        risk_score=85,
        status="open",
        evidence={},
        first_seen=datetime.now(timezone.utc),
        last_seen=datetime.now(timezone.utc),
        exception_reason=None,
        exception_approved_by=None,
        exception_expires_at=None,
    )
    acc = SimpleNamespace(label="Staging", account_id="999999999999")
    out = _to_out(f, {acc_id: acc})
    assert out.account_name == "Staging"
    assert out.account_provider == "aws"


def test_to_out_github_uses_org_scope_not_aws_account():
    acc_id = uuid.uuid4()
    f = SimpleNamespace(
        id=uuid.uuid4(),
        account_id=acc_id,
        check_id="github.org.mfa_not_enforced",
        resource_arn="github://org/acme-corp",
        title="MFA not enforced",
        severity="high",
        risk_score=80,
        status="open",
        evidence={"source": "acme-corp", "provider_type": "github"},
        first_seen=datetime.now(timezone.utc),
        last_seen=datetime.now(timezone.utc),
        exception_reason=None,
        exception_approved_by=None,
        exception_expires_at=None,
    )
    acc = SimpleNamespace(label="prod-aws", account_id="123456789012")
    out = _to_out(f, {acc_id: acc})
    assert out.account_provider == "github"
    assert out.account_name == "acme-corp"
    assert out.account_label == "acme-corp"
