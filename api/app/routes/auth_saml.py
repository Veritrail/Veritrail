"""SAML 2.0 SP-initiated enterprise SSO (per-org IdP).

Signature, audience, destination and time-condition validation are performed by
python3-saml (OneLogin). That native dependency (xmlsec/libxml2) must be present
in the image — see api/Dockerfile and requirements.txt.

NOT YET integration-tested against a live IdP in this environment. Validate the
full round-trip against Okta / Azure AD before enabling in production.
"""
from __future__ import annotations

import re
import uuid
from urllib.parse import quote

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth_cookies import attach_refresh_cookie
from app.core.config import get_settings
from app.core.db import get_db
from app.core.route_deps import RequireAdmin
from app.core.security import current_principal, issue_refresh_token, issue_token
from app.models import OrgSamlConfig, User
from app.services.user_session import record_user_session

router = APIRouter()
settings = get_settings()
log = structlog.get_logger()

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$")
_EMAIL_ATTRS = (
    "email",
    "Email",
    "mail",
    "user.email",
    "urn:oid:0.9.2342.19200300.100.1.3",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
)


# ── SP / IdP settings plumbing ──────────────────────────────────────────────


def _sp_entity_id(slug: str) -> str:
    return f"{settings.API_PUBLIC_URL}/v1/auth/saml/{slug}/metadata"


def _sp_acs_url(slug: str) -> str:
    return f"{settings.API_PUBLIC_URL}/v1/auth/saml/{slug}/acs"


def _login_url(slug: str) -> str:
    return f"{settings.API_PUBLIC_URL}/v1/auth/saml/{slug}/login"


class SsoDiscoverIn(BaseModel):
    email: EmailStr


class SsoDiscoverOut(BaseModel):
    sso_enabled: bool
    login_url: str | None = None


@router.post("/sso/discover", response_model=SsoDiscoverOut)
def sso_discover(body: SsoDiscoverIn, db: Session = Depends(get_db)):
    """Domain routing for SSO login: if the email's domain maps to a verified
    workspace with SAML enabled, return that org's IdP login URL so the frontend
    can redirect. Public email domains never route to SSO."""
    from app.models.org_team import OrgDomain
    from app.services.org_domain import email_domain, is_public_email_domain

    domain = email_domain(str(body.email))
    if not domain or is_public_email_domain(domain):
        return SsoDiscoverOut(sso_enabled=False)

    d = db.scalar(select(OrgDomain).where(OrgDomain.domain == domain, OrgDomain.verified.is_(True)))
    if not d:
        return SsoDiscoverOut(sso_enabled=False)

    cfg = db.scalar(
        select(OrgSamlConfig).where(OrgSamlConfig.org_id == d.org_id, OrgSamlConfig.enabled.is_(True))
    )
    if not cfg:
        return SsoDiscoverOut(sso_enabled=False)

    return SsoDiscoverOut(sso_enabled=True, login_url=_login_url(cfg.slug))


def _saml_settings(cfg: OrgSamlConfig) -> dict:
    return {
        "strict": True,
        "debug": False,
        "sp": {
            "entityId": _sp_entity_id(cfg.slug),
            "assertionConsumerService": {
                "url": _sp_acs_url(cfg.slug),
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
            "NameIDFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
            "x509cert": "",
            "privateKey": "",
        },
        "idp": {
            "entityId": cfg.idp_entity_id,
            "singleSignOnService": {
                "url": cfg.idp_sso_url,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "x509cert": cfg.idp_x509_cert,
        },
        "security": {
            "wantAssertionsSigned": True,
            "wantMessagesSigned": False,
            "wantNameId": True,
            "requestedAuthnContext": False,
            "rejectUnsolicitedResponsesWithInResponseTo": False,
        },
    }


def _prepare_request(request: Request, post_data: dict | None = None) -> dict:
    url = request.url
    # Honor the reverse proxy (Caddy/nginx terminate TLS) so SAML Destination /
    # audience checks reconstruct the public https host, not the internal one.
    proto = request.headers.get("x-forwarded-proto", url.scheme)
    host = request.headers.get("x-forwarded-host") or url.hostname or ""
    return {
        "https": "on" if proto == "https" else "off",
        "http_host": host,
        "script_name": url.path,
        "get_data": dict(request.query_params),
        "post_data": post_data or {},
    }


def _load_auth(request: Request, cfg: OrgSamlConfig, post_data: dict | None = None):
    try:
        from onelogin.saml2.auth import OneLogin_Saml2_Auth
    except ImportError as e:  # pragma: no cover - native dep absent
        log.error("saml.dependency_missing", error=str(e))
        raise HTTPException(503, "SAML support is not installed on this server")
    return OneLogin_Saml2_Auth(_prepare_request(request, post_data), _saml_settings(cfg))


def _get_enabled_config(db: Session, slug: str) -> OrgSamlConfig:
    cfg = db.scalar(select(OrgSamlConfig).where(OrgSamlConfig.slug == slug))
    if not cfg or not cfg.enabled:
        raise HTTPException(404, "SAML is not configured for this organization")
    if not (cfg.idp_entity_id and cfg.idp_sso_url and cfg.idp_x509_cert):
        raise HTTPException(400, "SAML configuration is incomplete")
    return cfg


def _login_redirect(user: User, *, request: Request, db: Session) -> RedirectResponse:
    uid, oid = str(user.id), str(user.org_id)
    access = issue_token(uid, oid)
    refresh = issue_refresh_token(uid, oid, remember_me=True)
    record_user_session(db, user.id, refresh, request)
    db.commit()
    resp = RedirectResponse(f"{settings.FRONTEND_URL}/auth/callback?token={quote(access, safe='')}")
    attach_refresh_cookie(resp, refresh, remember_me=True)
    return resp


def _error_redirect(error: str) -> RedirectResponse:
    return RedirectResponse(f"{settings.FRONTEND_URL}/login?error={quote(error, safe='')}")


def _email_from_assertion(auth) -> str:
    nameid = (auth.get_nameid() or "").strip().lower()
    if "@" in nameid:
        return nameid
    attrs = auth.get_attributes() or {}
    for key in _EMAIL_ATTRS:
        val = attrs.get(key)
        if val:
            candidate = (val[0] if isinstance(val, list) else val) or ""
            candidate = str(candidate).strip().lower()
            if "@" in candidate:
                return candidate
    return ""


# ── SP-initiated flow ───────────────────────────────────────────────────────


@router.get("/saml/{slug}/metadata")
def saml_metadata(slug: str, db: Session = Depends(get_db)):
    cfg = db.scalar(select(OrgSamlConfig).where(OrgSamlConfig.slug == slug))
    if not cfg:
        raise HTTPException(404, "Unknown SAML organization")
    try:
        from onelogin.saml2.settings import OneLogin_Saml2_Settings
    except ImportError:  # pragma: no cover - native dep absent
        raise HTTPException(503, "SAML support is not installed on this server")
    saml_settings = OneLogin_Saml2_Settings(_saml_settings(cfg), sp_validation_only=True)
    metadata = saml_settings.get_sp_metadata()
    errors = saml_settings.validate_metadata(metadata)
    if errors:
        log.error("saml.metadata_invalid", slug=slug, errors=errors)
        raise HTTPException(500, "Invalid SP metadata")
    return Response(content=metadata, media_type="application/xml")


@router.get("/saml/{slug}/login")
def saml_login(slug: str, request: Request, db: Session = Depends(get_db)):
    cfg = _get_enabled_config(db, slug)
    auth = _load_auth(request, cfg)
    return RedirectResponse(auth.login())


@router.post("/saml/{slug}/acs")
async def saml_acs(slug: str, request: Request, db: Session = Depends(get_db)):
    cfg = _get_enabled_config(db, slug)
    form = await request.form()
    post_data = {k: str(v) for k, v in form.items()}
    auth = _load_auth(request, cfg, post_data)
    auth.process_response()

    errors = auth.get_errors()
    if errors:
        log.warning("saml.acs_errors", slug=slug, errors=errors, reason=auth.get_last_error_reason())
        return _error_redirect("saml_invalid_response")
    if not auth.is_authenticated():
        return _error_redirect("saml_not_authenticated")

    email = _email_from_assertion(auth)
    if not email:
        return _error_redirect("saml_no_email")

    user = db.scalar(select(User).where(User.email == email))
    if user and user.org_id != cfg.org_id:
        # Global email uniqueness: this identity already belongs to another org.
        log.warning("saml.email_other_org", slug=slug, email=email)
        return _error_redirect("saml_email_other_org")
    if not user:
        if not settings.ALLOW_SSO_SIGNUP:
            log.warning("saml.signup_blocked", slug=slug, email=email)
            return _error_redirect("no_account_for_idp")
        user = User(
            id=uuid.uuid4(),
            org_id=cfg.org_id,
            email=email,
            password_hash="",
            role="viewer",
        )
        db.add(user)
        log.info("saml.jit_provisioned", slug=slug, email=email, org_id=str(cfg.org_id))

    db.commit()
    log.info("saml.login", slug=slug, user_id=str(user.id), org_id=str(cfg.org_id))
    return _login_redirect(user, request=request, db=db)


# ── Admin configuration (authenticated, org-scoped) ─────────────────────────


class SamlConfigOut(BaseModel):
    enabled: bool
    slug: str
    idp_entity_id: str
    idp_sso_url: str
    idp_x509_cert: str
    sp_entity_id: str
    sp_acs_url: str
    sp_metadata_url: str
    login_url: str


class SamlConfigIn(BaseModel):
    enabled: bool = False
    slug: str
    idp_entity_id: str = ""
    idp_sso_url: str = ""
    idp_x509_cert: str = ""


def _config_out(cfg: OrgSamlConfig) -> SamlConfigOut:
    return SamlConfigOut(
        enabled=cfg.enabled,
        slug=cfg.slug,
        idp_entity_id=cfg.idp_entity_id,
        idp_sso_url=cfg.idp_sso_url,
        idp_x509_cert=cfg.idp_x509_cert,
        sp_entity_id=_sp_entity_id(cfg.slug),
        sp_acs_url=_sp_acs_url(cfg.slug),
        sp_metadata_url=_sp_entity_id(cfg.slug),
        login_url=_login_url(cfg.slug),
    )


@router.get("/saml/config")
def get_saml_config(p=Depends(current_principal), db: Session = Depends(get_db)) -> SamlConfigOut | None:
    org_id = uuid.UUID(p["org_id"])
    cfg = db.scalar(select(OrgSamlConfig).where(OrgSamlConfig.org_id == org_id))
    return _config_out(cfg) if cfg else None


@router.put("/saml/config", response_model=SamlConfigOut)
def put_saml_config(body: SamlConfigIn, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org_id = uuid.UUID(p["org_id"])
    slug = body.slug.strip().lower()
    if not _SLUG_RE.match(slug):
        raise HTTPException(400, "Slug must be 3-60 chars: lowercase letters, numbers, or hyphens")

    clash = db.scalar(
        select(OrgSamlConfig).where(OrgSamlConfig.slug == slug, OrgSamlConfig.org_id != org_id)
    )
    if clash:
        raise HTTPException(409, "That slug is already in use")

    idp_entity_id = body.idp_entity_id.strip()
    idp_sso_url = body.idp_sso_url.strip()
    idp_x509_cert = body.idp_x509_cert.strip()
    if body.enabled and not (idp_entity_id and idp_sso_url and idp_x509_cert):
        raise HTTPException(400, "Provide IdP entity ID, SSO URL, and certificate before enabling")

    cfg = db.scalar(select(OrgSamlConfig).where(OrgSamlConfig.org_id == org_id))
    if not cfg:
        cfg = OrgSamlConfig(id=uuid.uuid4(), org_id=org_id, slug=slug)
        db.add(cfg)
    cfg.slug = slug
    cfg.enabled = body.enabled
    cfg.idp_entity_id = idp_entity_id
    cfg.idp_sso_url = idp_sso_url
    cfg.idp_x509_cert = idp_x509_cert
    db.commit()
    db.refresh(cfg)
    log.info("saml.config_updated", org_id=str(org_id), slug=slug, enabled=cfg.enabled)
    return _config_out(cfg)
