"""SAML ACS handler — assertion consumption, JIT provisioning, error paths.

The native python3-saml dependency is not exercised: `_load_auth` is patched to
return a fake OneLogin auth object so the provisioning/redirect logic is covered
without xmlsec or a live IdP.
"""
from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.routes import auth_saml


def _config(org_id: uuid.UUID, *, enabled: bool = True, slug: str = "acme") -> MagicMock:
    cfg = MagicMock()
    cfg.enabled = enabled
    cfg.org_id = org_id
    cfg.slug = slug
    cfg.idp_entity_id = "https://idp.example.com/metadata"
    cfg.idp_sso_url = "https://idp.example.com/sso"
    cfg.idp_x509_cert = "MIIC...cert"
    return cfg


def _fake_auth(*, authenticated: bool = True, errors=None, nameid="user@acme.com", attrs=None) -> MagicMock:
    auth = MagicMock()
    auth.process_response.return_value = None
    auth.get_errors.return_value = errors or []
    auth.get_last_error_reason.return_value = "reason"
    auth.is_authenticated.return_value = authenticated
    auth.get_nameid.return_value = nameid
    auth.get_attributes.return_value = attrs or {}
    return auth


def _request(form: dict | None = None) -> MagicMock:
    req = MagicMock()
    req.form = AsyncMock(return_value=form if form is not None else {"SAMLResponse": "x"})
    return req


def _run_acs(monkeypatch, *, db, auth, slug="acme"):
    monkeypatch.setattr(auth_saml, "_load_auth", lambda *a, **k: auth)
    return asyncio.run(auth_saml.saml_acs(slug, _request(), db))


def test_acs_provisions_new_user_and_redirects_with_token(monkeypatch):
    monkeypatch.setattr(auth_saml.settings, "ALLOW_SSO_SIGNUP", True)
    org_id = uuid.uuid4()
    db = MagicMock()
    # 1st scalar: enabled config lookup. 2nd: user-by-email (none -> JIT provision).
    db.scalar.side_effect = [_config(org_id), None]

    resp = _run_acs(monkeypatch, db=db, auth=_fake_auth(nameid="new@acme.com"))

    # JIT user + session row on login redirect
    assert db.add.call_count == 2
    created = db.add.call_args_list[0][0][0]
    assert created.email == "new@acme.com"
    assert created.org_id == org_id
    assert created.role == "viewer"
    assert db.commit.call_count == 2

    assert resp.status_code in (302, 303, 307)
    assert "/auth/callback?token=" in resp.headers["location"]


def test_acs_existing_user_logs_in(monkeypatch):
    org_id = uuid.uuid4()
    existing = MagicMock()
    existing.id = uuid.uuid4()
    existing.org_id = org_id
    existing.email = "user@acme.com"
    db = MagicMock()
    db.scalar.side_effect = [_config(org_id), existing]

    resp = _run_acs(monkeypatch, db=db, auth=_fake_auth())

    from app.models.user_session import UserSession

    db.add.assert_called_once()
    assert isinstance(db.add.call_args[0][0], UserSession)
    assert "/auth/callback?token=" in resp.headers["location"]


def test_acs_rejects_email_owned_by_another_org(monkeypatch):
    other = MagicMock()
    other.org_id = uuid.uuid4()  # different org than the config
    db = MagicMock()
    db.scalar.side_effect = [_config(uuid.uuid4()), other]

    resp = _run_acs(monkeypatch, db=db, auth=_fake_auth())

    db.add.assert_not_called()
    assert "error=saml_email_other_org" in resp.headers["location"]


def test_acs_invalid_response_redirects_to_login_error(monkeypatch):
    db = MagicMock()
    db.scalar.side_effect = [_config(uuid.uuid4())]

    resp = _run_acs(monkeypatch, db=db, auth=_fake_auth(errors=["invalid_response"]))

    db.add.assert_not_called()
    db.commit.assert_not_called()
    assert "error=saml_invalid_response" in resp.headers["location"]


def test_acs_not_authenticated_redirects(monkeypatch):
    db = MagicMock()
    db.scalar.side_effect = [_config(uuid.uuid4())]

    resp = _run_acs(monkeypatch, db=db, auth=_fake_auth(authenticated=False))

    assert "error=saml_not_authenticated" in resp.headers["location"]


def test_acs_no_email_redirects(monkeypatch):
    db = MagicMock()
    db.scalar.side_effect = [_config(uuid.uuid4())]

    # NameID is not an email and no email attribute present
    resp = _run_acs(monkeypatch, db=db, auth=_fake_auth(nameid="not-an-email", attrs={}))

    assert "error=saml_no_email" in resp.headers["location"]


def test_acs_blocks_jit_when_signup_disabled(monkeypatch):
    monkeypatch.setattr(auth_saml.settings, "ALLOW_SSO_SIGNUP", False)
    db = MagicMock()
    db.scalar.side_effect = [_config(uuid.uuid4()), None]

    resp = _run_acs(monkeypatch, db=db, auth=_fake_auth(nameid="new@acme.com"))

    db.add.assert_not_called()
    assert "error=no_account_for_idp" in resp.headers["location"]


def test_email_from_assertion_attribute_fallback():
    auth = _fake_auth(nameid="opaque-name-id", attrs={"email": ["fallback@acme.com"]})
    assert auth_saml._email_from_assertion(auth) == "fallback@acme.com"


def test_email_from_assertion_prefers_email_nameid():
    auth = _fake_auth(nameid="Primary@Acme.com", attrs={"email": ["other@acme.com"]})
    assert auth_saml._email_from_assertion(auth) == "primary@acme.com"


@pytest.mark.parametrize("slug", ["", "a", "Bad_Slug", "x" * 61, "-bad", "bad-"])
def test_put_config_rejects_bad_slug(monkeypatch, slug):
    from fastapi import HTTPException

    body = auth_saml.SamlConfigIn(slug=slug)
    db = MagicMock()
    with pytest.raises(HTTPException) as exc:
        auth_saml.put_saml_config(body, _rbac=MagicMock(), p={"org_id": str(uuid.uuid4())}, db=db)
    assert exc.value.status_code == 400
