"""Tests for auditor portal: invite, token verify, access control, and activity logging."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from fastapi import status


def _fake_uuid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def org_id() -> str:
    return _fake_uuid()


@pytest.fixture
def user_id() -> str:
    return _fake_uuid()


@pytest.fixture
def auditor_access_id() -> str:
    return _fake_uuid()


@pytest.fixture
def auditor_access(org_id, user_id, auditor_access_id):
    """Mock AuditorAccess grant."""
    from app.models.auditor import AuditorAccess
    grant = MagicMock(spec=AuditorAccess)
    grant.id = uuid.UUID(auditor_access_id)
    grant.org_id = uuid.UUID(org_id)
    grant.email = "auditor@firm.com"
    grant.name = "Alice Auditor"
    grant.access_token = f"auditor-token-{auditor_access_id[:8]}"
    grant.expires_at = datetime.now(timezone.utc) + timedelta(days=30)
    grant.is_active = True
    grant.created_by = uuid.UUID(user_id)
    grant.last_accessed_at = None
    return grant


# ── JWT token issuance ──────────────────────────────────────────────

def test_issue_token_has_scope():
    from app.core.security import issue_token
    org = _fake_uuid()
    tok = issue_token("user-1", org)
    from jose import jwt
    from app.core.config import get_settings
    payload = jwt.decode(tok, get_settings().JWT_SECRET, algorithms=[get_settings().JWT_ALG])
    assert payload["scope"] == "user"
    assert payload["org_id"] == org


def test_issue_auditor_token_has_auditor_scope(auditor_access_id):
    from app.core.security import issue_auditor_token
    org = _fake_uuid()
    tok = issue_auditor_token(auditor_access_id, org)
    from jose import jwt
    from app.core.config import get_settings
    payload = jwt.decode(tok, get_settings().JWT_SECRET, algorithms=[get_settings().JWT_ALG])
    assert payload["scope"] == "auditor"
    assert payload["auditor_access_id"] == auditor_access_id
    assert payload["org_id"] == org
    assert payload["sub"] == f"auditor:{auditor_access_id}"


# ── Token verification ──────────────────────────────────────────────

def test_verify_auditor_token_valid(auditor_access, auditor_access_id):
    """POST /v1/auditor/verify/{token} returns JWT for valid, non-expired token."""
    from app.models.org import Org

    mock_org = MagicMock(spec=Org)
    mock_org.name = "Test Corp"

    db = MagicMock()

    # Set up scalars().where().all() to return [auditor_access]
    where_mock = MagicMock()
    where_mock.all.return_value = [auditor_access]
    db.scalars.return_value = where_mock

    db.get.return_value = mock_org

    from app.routes.auditor import verify_auditor_token
    from app.core.config import get_settings
    from jose import jwt

    response = verify_auditor_token(access_token=auditor_access.access_token, db=db)

    assert response.access_token
    assert response.org_name == "Test Corp"
    assert response.auditor_name == "Alice Auditor"

    # Verify the returned JWT has auditor scope
    payload = jwt.decode(response.access_token, get_settings().JWT_SECRET, algorithms=[get_settings().JWT_ALG])
    assert payload["scope"] == "auditor"


def test_verify_auditor_token_expired(auditor_access):
    """Expired tokens should result in 401."""
    auditor_access.expires_at = datetime.now(timezone.utc) - timedelta(days=1)

    db = MagicMock()
    where_mock = MagicMock()
    where_mock.all.return_value = [auditor_access]
    db.scalars.return_value = where_mock

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        from app.routes.auditor import verify_auditor_token
        verify_auditor_token(access_token=auditor_access.access_token, db=db)
    assert exc.value.status_code == 401
    assert "expired" in str(exc.value.detail).lower()


def test_verify_auditor_token_invalid():
    """Invalid tokens should result in 401."""
    db = MagicMock()
    where_mock = MagicMock()
    where_mock.all.return_value = []
    db.scalars.return_value = where_mock

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        from app.routes.auditor import verify_auditor_token
        verify_auditor_token(access_token="nonexistent", db=db)
    assert exc.value.status_code == 401


# ── Access control — auditor scope gate ─────────────────────────────

def test_current_user_principal_rejects_auditor():
    """current_user_principal should reject auditor-scoped JWTs."""
    from app.core.security import issue_auditor_token, current_user_principal
    from fastapi.security import HTTPAuthorizationCredentials
    from fastapi import HTTPException

    aid = _fake_uuid()
    org = _fake_uuid()
    tok = issue_auditor_token(aid, org)

    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=tok)
    with pytest.raises(HTTPException) as exc:
        current_user_principal(creds)
    assert exc.value.status_code == 403


def test_current_auditor_principal_accepts_auditor():
    """current_auditor_principal should accept auditor-scoped JWTs."""
    from app.core.security import issue_auditor_token, current_auditor_principal
    from fastapi.security import HTTPAuthorizationCredentials

    aid = _fake_uuid()
    org = _fake_uuid()
    tok = issue_auditor_token(aid, org)

    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=tok)
    payload = current_auditor_principal(creds)
    assert payload["scope"] == "auditor"


def test_current_auditor_principal_rejects_user():
    """current_auditor_principal should reject user-scoped JWTs."""
    from app.core.security import issue_token, current_auditor_principal
    from fastapi.security import HTTPAuthorizationCredentials
    from fastapi import HTTPException

    org = _fake_uuid()
    tok = issue_token("user-1", org)

    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=tok)
    with pytest.raises(HTTPException) as exc:
        current_auditor_principal(creds)
    assert exc.value.status_code == 403


# ── Auditor invite ──────────────────────────────────────────────────

def test_dedupe_auditors_by_email():
    from app.routes.auditor import _dedupe_auditors_by_email
    from app.models.auditor import AuditorAccess

    org_id = uuid.uuid4()
    older = AuditorAccess(
        org_id=org_id,
        email="auditor@test.com",
        access_token="a" * 64,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        is_active=False,
    )
    newer = AuditorAccess(
        org_id=org_id,
        email="Auditor@test.com",
        access_token="b" * 64,
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        is_active=True,
    )
    older.created_at = datetime.now(timezone.utc) - timedelta(days=10)
    newer.created_at = datetime.now(timezone.utc)

    out = _dedupe_auditors_by_email([newer, older])
    assert len(out) == 1
    assert out[0].access_token == "b" * 64


def test_invite_auditor_creates_grant():
    """Inviting an auditor creates an AuditorAccess with token and expiry."""
    from app.models.org import Org
    org = MagicMock(spec=Org)
    org.id = uuid.UUID(_fake_uuid())

    db = MagicMock()
    db.get.return_value = org

    from app.routes.auditor import invite_auditor, AuditorInviteIn

    org_id = str(org.id)
    principal = {"sub": _fake_uuid(), "org_id": org_id, "scope": "user"}

    body = AuditorInviteIn(email="auditor@test.com", name="Test Auditor", expiry_days=30)
    result = invite_auditor(body=body, _rbac=MagicMock(), p=principal, db=db)

    # Check that db.add was called with an AuditorAccess
    assert db.add.called
    assert db.commit.called
    args = db.add.call_args[0][0]
    assert args.email == "auditor@test.com"
    assert args.name == "Test Auditor"
    assert args.is_active is True
    assert len(args.access_token) == 64  # 32-char hex + 32-char hex


# ── Audit activity logging ──────────────────────────────────────────

def test_audit_activity_log_model():
    """AuditActivityLog model can be constructed."""
    from app.models.auditor import AuditActivityLog
    log = AuditActivityLog(
        auditor_access_id=uuid.uuid4(),
        action="view_finding",
        resource_type="finding",
        resource_id="f-123",
    )
    assert log.action == "view_finding"
    assert log.resource_type == "finding"
    assert log.resource_id == "f-123"


# ── Trust Center Config ─────────────────────────────────────────────

def test_trust_center_config_model():
    """TrustCenterConfig model can be constructed."""
    from app.models.auditor import TrustCenterConfig
    config = TrustCenterConfig(
        org_id=uuid.uuid4(),
        is_enabled=True,
        subdomain_slug="acme-corp",
        company_name="ACME Corp",
        company_logo_url=None,
        frameworks_to_show=["soc2", "cis_aws_l1"],
    )
    assert config.is_enabled is True
    assert config.subdomain_slug == "acme-corp"
    assert config.frameworks_to_show == ["soc2", "cis_aws_l1"]


# ── Settings endpoints ──────────────────────────────────────────────

def test_get_trust_center_settings_not_configured():
    """GET /v1/settings/trust-center returns unconfigured state when no config."""
    from app.models.org import Org
    org = MagicMock(spec=Org)
    org.id = uuid.UUID(_fake_uuid())

    db = MagicMock()
    db.get.return_value = org
    db.scalar.return_value = None

    from app.routes.settings import get_trust_center_settings
    principal = {"sub": _fake_uuid(), "org_id": str(org.id), "scope": "user"}
    result = get_trust_center_settings(p=principal, db=db)
    assert result.is_enabled is False
    assert result.configured is False
    assert result.subdomain_slug is None


def test_trust_center_public_route_not_found():
    """GET /trust/{slug} returns 404 when not configured."""
    db = MagicMock()
    db.scalar.return_value = None

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        from app.routes.trust_center import get_trust_center
        get_trust_center(subdomain_slug="nonexistent", db=db)
    assert exc.value.status_code == 404
    assert "not found" in str(exc.value.detail).lower()


def test_trust_center_public_profile_has_no_numeric_leaks():
    """Public trust center returns profile fields only — no scores or gap counts."""
    from datetime import datetime, timezone
    from app.models.auditor import TrustCenterConfig
    from app.models.org import Org
    from app.models import AwsAccount

    org_id = uuid.uuid4()
    config = TrustCenterConfig(
        org_id=org_id,
        is_enabled=True,
        subdomain_slug="acme",
        company_name="ACME Corp",
        frameworks_to_show=["soc2"],
    )
    org = Org(id=org_id, name="ACME Corp")
    account = AwsAccount(
        id=uuid.uuid4(),
        org_id=org_id,
        status="connected",
        last_scan_at=datetime.now(timezone.utc),
    )

    db = MagicMock()
    db.scalar.return_value = config
    db.get.return_value = org
    db.scalars.return_value.all.return_value = [account]

    from app.routes.trust_center import get_trust_center

    result = get_trust_center(subdomain_slug="acme", db=db)
    payload = result.model_dump()

    assert payload["company_name"] == "ACME Corp"
    assert payload["monitoring_active"] is True
    assert payload["refresh_cadence"] == "daily"
    assert payload["frameworks"][0]["framework_label"] == "SOC 2"
    assert payload["documents"]

    forbidden = (
        "open_findings_count",
        "top_gaps",
        "score_pct",
        "connected_accounts",
        "last_scan_at",
        "controls_evaluated",
        "recent_activity",
    )
    for key in forbidden:
        assert key not in payload


# ── Auditor listing ─────────────────────────────────────────────────

def test_list_auditors_returns_grants():
    """GET /v1/auditor/list returns auditor grants for the org."""
    from app.models.org import Org
    from app.models.auditor import AuditorAccess

    org = MagicMock(spec=Org)
    org.id = uuid.UUID(_fake_uuid())

    grant = MagicMock(spec=AuditorAccess)
    grant.id = uuid.uuid4()
    grant.email = "a@b.com"
    grant.name = "Alice"
    grant.access_token = "abc123" * 8
    grant.expires_at = datetime.now(timezone.utc) + timedelta(days=30)
    grant.is_active = True
    grant.created_at = datetime.now(timezone.utc)
    grant.last_accessed_at = None

    db = MagicMock()
    db.get.return_value = org

    # The select → where → order_by → scalars → all chain
    all_mock = MagicMock()
    all_mock.all.return_value = [grant]
    order_mock = MagicMock()
    order_mock.where.return_value = all_mock
    order_mock.all.return_value = [grant]
    select_result = MagicMock()
    select_result.order_by.return_value = order_mock
    select_result.where.return_value = all_mock

    # scalars is called and returns the order_mock
    db.scalars.return_value = order_mock

    from app.routes.auditor import list_auditors
    principal = {"sub": _fake_uuid(), "org_id": str(org.id), "scope": "user"}
    result = list_auditors(p=principal, db=db)
    assert len(result) == 1
    assert result[0].email == "a@b.com"
    assert result[0].name == "Alice"


# ── Auditor revoke ──────────────────────────────────────────────────

def test_revoke_auditor_sets_inactive():
    """DELETE /v1/auditor/{id} sets is_active=False."""
    from app.models.org import Org
    from app.models.auditor import AuditorAccess

    org = MagicMock(spec=Org)
    org.id = uuid.UUID(_fake_uuid())

    grant = MagicMock(spec=AuditorAccess)
    grant.org_id = org.id
    grant.is_active = True

    db = MagicMock()
    db.get.side_effect = lambda model, id_: org if id_ == org.id else grant

    from app.routes.auditor import revoke_auditor
    principal = {"sub": _fake_uuid(), "org_id": str(org.id), "scope": "user"}
    result = revoke_auditor(auditor_id=str(uuid.uuid4()), p=principal, db=db)
    assert result["ok"] is True
    assert grant.is_active is False
    assert db.commit.called
