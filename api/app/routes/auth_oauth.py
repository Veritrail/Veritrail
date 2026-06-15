"""OAuth 2.0 — Google and GitHub authorization code flows."""
from __future__ import annotations

import uuid
from urllib.parse import quote, urlencode

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.auth_cookies import attach_refresh_cookie
from app.core.security import current_principal, issue_mfa_challenge_token, issue_refresh_token, issue_token
from app.models import AwsAccount, Org, User
from app.services.org_invites import provision_sso_user
from app.services.user_session import record_user_session

router = APIRouter()
settings = get_settings()
log = structlog.get_logger()

_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

_GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize"
_GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
_GITHUB_USER_URL = "https://api.github.com/user"
_GITHUB_EMAIL_URL = "https://api.github.com/user/emails"

_GITLAB_COM = "https://gitlab.com"


def _google_callback_uri() -> str:
    return f"{settings.API_PUBLIC_URL}/v1/auth/google/callback"


def _github_callback_uri() -> str:
    return f"{settings.API_PUBLIC_URL}/v1/auth/github/callback"


def _gitlab_callback_uri() -> str:
    return f"{settings.API_PUBLIC_URL}/v1/auth/gitlab/callback"


def _frontend_url() -> str:
    return settings.FRONTEND_URL


def _valid_link_token(link_token: str | None) -> bool:
    return bool(link_token and link_token not in ("null", "undefined"))


def _oauth_login_state(*, remember: str | None) -> str:
    if remember == "0":
        return "login-noremember"
    return "login"


def _remember_me_from_oauth_state(state: str | None) -> bool:
    return state != "login-noremember"


def _oauth_login_redirect(
    user: User,
    *,
    remember_me: bool = True,
    request: Request | None = None,
    db: Session | None = None,
) -> RedirectResponse:
    uid, oid = str(user.id), str(user.org_id)
    if user.totp_enabled:
        mfa_token = issue_mfa_challenge_token(uid, oid, remember_me=remember_me)
        return RedirectResponse(f"{_frontend_url()}/login?mfa_token={quote(mfa_token, safe='')}")
    token = issue_token(uid, oid)
    refresh = issue_refresh_token(uid, oid, remember_me=remember_me)
    if request is not None and db is not None:
        record_user_session(db, user.id, refresh, request)
        db.commit()
    resp = RedirectResponse(f"{_frontend_url()}/auth/callback?token={quote(token, safe='')}")
    attach_refresh_cookie(resp, refresh, remember_me=remember_me)
    return resp


def _oauth_link_redirect(user: User, provider: str) -> RedirectResponse:
    """Re-issue session after linking an IdP — skips MFA (link_token already proved identity)."""
    uid, oid = str(user.id), str(user.org_id)
    access = issue_token(uid, oid)
    refresh = issue_refresh_token(uid, oid, remember_me=True)
    next_path = f"/account?{provider}=linked"
    resp = RedirectResponse(
        f"{_frontend_url()}/auth/callback?"
        f"token={quote(access, safe='')}&"
        f"next={quote(next_path, safe='')}"
    )
    attach_refresh_cookie(resp, refresh, remember_me=True)
    return resp


def _link_error_redirect(provider: str, error: str) -> RedirectResponse:
    """Redirect a link-flow failure back to /account — the user is logged in
    and shouldn't be bounced to the sign-in page."""
    return RedirectResponse(
        f"{_frontend_url()}/account?provider={quote(provider, safe='')}&error={quote(error, safe='')}"
    )


def _is_link_state(state: str | None) -> bool:
    return bool(state and state.startswith("link:"))


def _callback_error(state: str | None, provider: str, error: str) -> RedirectResponse:
    """Redirect an OAuth callback error to the right page based on flow.

    Link flow → /account (user is logged in).
    Login flow → /login (user is not).
    """
    if _is_link_state(state):
        return _link_error_redirect(provider, error)
    return RedirectResponse(f"{_frontend_url()}/login?error={quote(error, safe='')}")


def _provision_sso_user_or_redirect(
    provider: str,
    db: Session,
    *,
    email: str,
    **identity_fields,
) -> tuple[User, bool] | RedirectResponse:
    try:
        return provision_sso_user(db, email=email, **identity_fields)
    except HTTPException as exc:
        if exc.status_code == 403:
            log.warning("oauth.signup.blocked", provider=provider, email=email)
            return RedirectResponse(f"{_frontend_url()}/login?error=no_account_for_idp")
        if exc.status_code == 409:
            log.warning("oauth.signup.domain_managed", provider=provider, email=email)
            return RedirectResponse(f"{_frontend_url()}/login?error=domain_managed")
        raise


def _claim_or_block(
    db: Session,
    current_user_id: str,
    existing: User | None,
    provider: str,
    field: str,
) -> RedirectResponse | None:
    """Resolve a link-time conflict where another user already owns this IdP.

    Returns None if there is no conflict, or if the conflicting user is an
    orphan (no AWS accounts in their org) and we successfully claimed the IdP.
    Returns a RedirectResponse if the conflict cannot be resolved.

    An orphan's IdP is freed by either deleting the whole org (if they are
    the only user there) or just nulling the IdP field (multi-user org).
    """
    if not existing or str(existing.id) == current_user_id:
        return None

    aws_count = db.scalar(
        select(func.count()).select_from(AwsAccount).where(AwsAccount.org_id == existing.org_id)
    ) or 0
    if aws_count > 0:
        return _link_error_redirect(provider, f"{provider}_already_linked")

    users_in_org = db.scalar(
        select(func.count()).select_from(User).where(User.org_id == existing.org_id)
    ) or 0

    if users_in_org <= 1:
        # SQL-level delete: ORM cascade would try to SET users.org_id = NULL first
        # (violating NOT NULL). DB-level ON DELETE CASCADE on User.org_id handles
        # the dependent rows correctly.
        orphan_org_id = existing.org_id
        orphan_user_id = str(existing.id)
        orphan_email = existing.email
        db.expunge(existing)
        db.execute(delete(Org).where(Org.id == orphan_org_id))
        log.info(
            "oauth.link.claimed_orphan_org",
            provider=provider,
            claimant_user_id=current_user_id,
            orphan_user_id=orphan_user_id,
            orphan_email=orphan_email,
            orphan_org_id=str(orphan_org_id),
        )
    else:
        setattr(existing, field, None)
        db.flush()
        log.info(
            "oauth.link.freed_orphan_idp",
            provider=provider,
            claimant_user_id=current_user_id,
            previous_owner_user_id=str(existing.id),
        )

    return None


# ── Google ────────────────────────────────────────────────────────────────────

@router.get("/google")
def google_login(link_token: str | None = None, remember: str | None = None):
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(400, "Google OAuth not configured")
    if _valid_link_token(link_token):
        state = f"link:{link_token}"
    else:
        state = _oauth_login_state(remember=remember)
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": _google_callback_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
        "state": state,
    }
    if settings.APP_ENV == "production" and settings.GOOGLE_ALLOWED_DOMAIN:
        params["hd"] = settings.GOOGLE_ALLOWED_DOMAIN
    return RedirectResponse(f"{_GOOGLE_AUTH_URL}?{urlencode(params)}")


@router.get("/google/callback")
def google_callback(
    request: Request,
    code: str | None = None,
    error: str | None = None,
    state: str | None = None,
    db: Session = Depends(get_db),
):
    if error or not code:
        return _callback_error(state, "google", "oauth_denied")

    try:
        with httpx.Client(timeout=10) as client:
            token_resp = client.post(_GOOGLE_TOKEN_URL, data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": _google_callback_uri(),
                "grant_type": "authorization_code",
            })
            if token_resp.status_code != 200:
                return _callback_error(state, "google", "oauth_failed")

            access_token = token_resp.json()["access_token"]
            info_resp = client.get(_GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
            if info_resp.status_code != 200:
                return _callback_error(state, "google", "oauth_failed")

        info = info_resp.json()
        email: str = info.get("email", "").lower()
        name: str = info.get("name") or email.split("@")[0]
        google_id: str = str(info.get("sub") or "")

        if not email or not google_id:
            return _callback_error(state, "google", "no_email")

        if settings.APP_ENV == "production" and settings.GOOGLE_ALLOWED_DOMAIN and not email.endswith(f"@{settings.GOOGLE_ALLOWED_DOMAIN}"):
            return _callback_error(state, "google", "domain_not_allowed")

        # link flow: attach google_id to existing account
        if state and state.startswith("link:"):
            link_token_val = state[5:]
            try:
                from jose import jwt as _jwt
                payload = _jwt.decode(link_token_val, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
                user_id = payload["sub"]
            except Exception:
                return _link_error_redirect("google", "bad_link_token")

            existing = db.scalar(select(User).where(User.google_id == google_id))
            blocked = _claim_or_block(db, user_id, existing, "google", "google_id")
            if blocked:
                return blocked

            user = db.get(User, uuid.UUID(user_id))
            if not user:
                return _link_error_redirect("google", "not_found")
            user.google_id = google_id
            db.commit()
            return _oauth_link_redirect(user, "google")

        user = db.scalar(select(User).where(User.google_id == google_id))
        if not user:
            user = db.scalar(select(User).where(User.email == email))

        if not user:
            provisioned = _provision_sso_user_or_redirect(
                "google", db, email=email, google_id=google_id
            )
            if isinstance(provisioned, RedirectResponse):
                return provisioned
            user, created = provisioned
            if created:
                log.info(
                    "oauth.signup.provisioned",
                    provider="google",
                    email=email,
                    google_id=google_id,
                    org_id=str(user.org_id),
                    user_id=str(user.id),
                )
        elif not user.google_id:
            user.google_id = google_id
            log.info(
                "oauth.idp_attached_by_email",
                provider="google",
                user_id=str(user.id),
                email=email,
                google_id=google_id,
            )
        db.commit()

        return _oauth_login_redirect(
            user,
            remember_me=_remember_me_from_oauth_state(state),
            request=request,
            db=db,
        )

    except Exception as e:
        log.exception("google.callback_error", error=str(e))
        return _callback_error(state, "google", "server_error")


# ── GitHub ────────────────────────────────────────────────────────────────────

@router.get("/github")
def github_login(link_token: str | None = None, remember: str | None = None):
    if not settings.GITHUB_CLIENT_ID:
        raise HTTPException(400, "GitHub OAuth not configured")
    if _valid_link_token(link_token):
        state = f"link:{link_token}"
    else:
        state = _oauth_login_state(remember=remember)
    params = {
        "client_id": settings.GITHUB_CLIENT_ID,
        "redirect_uri": _github_callback_uri(),
        "scope": "read:user user:email",
        "state": state,
    }
    return RedirectResponse(f"{_GITHUB_AUTH_URL}?{urlencode(params)}")


@router.get("/github/callback")
def github_callback(
    request: Request,
    code: str | None = None,
    error: str | None = None,
    state: str | None = None,
    db: Session = Depends(get_db),
):
    if is_github_integration_state(state):
        return handle_github_integration_callback(code=code, state=state, error=error, db=db)

    if error or not code:
        return _callback_error(state, "github", "oauth_denied")

    try:
        with httpx.Client(timeout=10) as client:
            token_resp = client.post(
                _GITHUB_TOKEN_URL,
                data={
                    "client_id": settings.GITHUB_CLIENT_ID,
                    "client_secret": settings.GITHUB_CLIENT_SECRET,
                    "code": code,
                    "redirect_uri": _github_callback_uri(),
                },
                headers={"Accept": "application/json"},
            )
            if token_resp.status_code != 200:
                return _callback_error(state, "github", "oauth_failed")

            gh_token = token_resp.json().get("access_token")
            if not gh_token:
                return _callback_error(state, "github", "oauth_failed")

            auth_headers = {"Authorization": f"Bearer {gh_token}", "Accept": "application/json"}

            user_resp = client.get(_GITHUB_USER_URL, headers=auth_headers)
            if user_resp.status_code != 200:
                return _callback_error(state, "github", "oauth_failed")

            gh_user = user_resp.json()
            github_id = str(gh_user["id"])

            # fetch primary verified email
            email_resp = client.get(_GITHUB_EMAIL_URL, headers=auth_headers)
            emails = email_resp.json() if email_resp.status_code == 200 else []
            primary = next(
                (e["email"] for e in emails if e.get("primary") and e.get("verified")),
                gh_user.get("email", ""),
            )
            email = (primary or "").lower()

        # ── link flow: attach github_id to existing account ──────────────────
        if state and state.startswith("link:"):
            link_token_val = state[5:]
            try:
                from app.core.security import get_settings as _gs
                from jose import jwt as _jwt
                s = get_settings()
                payload = _jwt.decode(link_token_val, s.JWT_SECRET, algorithms=[s.JWT_ALG])
                user_id = payload["sub"]
            except Exception:
                return _link_error_redirect("github", "bad_link_token")

            existing = db.scalar(select(User).where(User.github_id == github_id))
            blocked = _claim_or_block(db, user_id, existing, "github", "github_id")
            if blocked:
                return blocked

            user = db.get(User, uuid.UUID(user_id))
            if not user:
                return _link_error_redirect("github", "not_found")

            user.github_id = github_id
            db.commit()
            return _oauth_link_redirect(user, "github")

        # ── login/signup flow ─────────────────────────────────────────────────
        user = db.scalar(select(User).where(User.github_id == github_id))
        if not user and email:
            user = db.scalar(select(User).where(User.email == email))

        if not user:
            if not email:
                return _callback_error(state, "github", "no_email")
            provisioned = _provision_sso_user_or_redirect(
                "github", db, email=email, github_id=github_id
            )
            if isinstance(provisioned, RedirectResponse):
                return provisioned
            user, created = provisioned
            if created:
                log.info(
                    "oauth.signup.provisioned",
                    provider="github",
                    email=email,
                    github_id=github_id,
                    org_id=str(user.org_id),
                    user_id=str(user.id),
                )
        elif not user.github_id:
            user.github_id = github_id
            log.info(
                "oauth.idp_attached_by_email",
                provider="github",
                user_id=str(user.id),
                email=email,
                github_id=github_id,
            )

        db.commit()
        return _oauth_login_redirect(
            user,
            remember_me=_remember_me_from_oauth_state(state),
            request=request,
            db=db,
        )

    except Exception as e:
        log.exception("github.callback_error", error=str(e))
        return _callback_error(state, "github", "server_error")


# ── GitLab ────────────────────────────────────────────────────────────────────

@router.get("/gitlab")
def gitlab_login(link_token: str | None = None, remember: str | None = None):
    if not settings.GITLAB_CLIENT_ID:
        raise HTTPException(400, "GitLab OAuth not configured")
    if _valid_link_token(link_token):
        state = f"link:{link_token}"
    else:
        state = _oauth_login_state(remember=remember)
    params = {
        "client_id": settings.GITLAB_CLIENT_ID,
        "redirect_uri": _gitlab_callback_uri(),
        "response_type": "code",
        "scope": "read_user",
        "state": state,
    }
    return RedirectResponse(f"{_GITLAB_COM}/oauth/authorize?{urlencode(params)}")


@router.get("/gitlab/callback")
def gitlab_callback(
    request: Request,
    code: str | None = None,
    error: str | None = None,
    state: str | None = None,
    db: Session = Depends(get_db),
):
    if error or not code:
        return _callback_error(state, "gitlab", "oauth_denied")

    try:
        with httpx.Client(timeout=10) as client:
            # Try form-body credentials first; fall back to HTTP Basic Auth on 401
            # (RFC 6749 §2.3.1 — both are valid; some IdPs only accept one).
            common_data = {
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": _gitlab_callback_uri(),
            }
            token_resp = client.post(
                f"{_GITLAB_COM}/oauth/token",
                data={
                    **common_data,
                    "client_id": settings.GITLAB_CLIENT_ID,
                    "client_secret": settings.GITLAB_CLIENT_SECRET,
                },
                headers={"Accept": "application/json"},
            )
            if token_resp.status_code == 401:
                log.warning("gitlab.token.form_body_rejected", body=token_resp.text[:200])
                token_resp = client.post(
                    f"{_GITLAB_COM}/oauth/token",
                    data=common_data,
                    headers={"Accept": "application/json"},
                    auth=(settings.GITLAB_CLIENT_ID, settings.GITLAB_CLIENT_SECRET),
                )
            if token_resp.status_code != 200:
                log.warning(
                    "gitlab.token.exchange_failed",
                    status=token_resp.status_code,
                    body=token_resp.text[:300],
                )
                return _callback_error(state, "gitlab", "oauth_failed")

            access_token = token_resp.json().get("access_token")
            if not access_token:
                return _callback_error(state, "gitlab", "oauth_failed")

            auth_headers = {"Authorization": f"Bearer {access_token}"}
            user_resp = client.get(f"{_GITLAB_COM}/api/v4/user", headers=auth_headers)
            if user_resp.status_code != 200:
                log.warning("gitlab.user_fetch_failed", status=user_resp.status_code)
                return _callback_error(state, "gitlab", "oauth_failed")

            gl_user = user_resp.json()
            gitlab_id = str(gl_user["id"])
            email = (gl_user.get("email") or "").lower()

        if state and state.startswith("link:"):
            link_token_val = state[5:]
            try:
                from jose import jwt as _jwt
                payload = _jwt.decode(link_token_val, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
                user_id = payload["sub"]
            except Exception:
                return _link_error_redirect("gitlab", "bad_link_token")

            existing = db.scalar(select(User).where(User.gitlab_id == gitlab_id))
            blocked = _claim_or_block(db, user_id, existing, "gitlab", "gitlab_id")
            if blocked:
                return blocked

            user = db.get(User, uuid.UUID(user_id))
            if not user:
                return _link_error_redirect("gitlab", "not_found")

            user.gitlab_id = gitlab_id
            db.commit()
            return _oauth_link_redirect(user, "gitlab")

        user = db.scalar(select(User).where(User.gitlab_id == gitlab_id))
        if not user and email:
            user = db.scalar(select(User).where(User.email == email))

        if not user:
            if not email:
                return _callback_error(state, "gitlab", "no_email")
            provisioned = _provision_sso_user_or_redirect(
                "gitlab", db, email=email, gitlab_id=gitlab_id
            )
            if isinstance(provisioned, RedirectResponse):
                return provisioned
            user, created = provisioned
            if created:
                log.info(
                    "oauth.signup.provisioned",
                    provider="gitlab",
                    email=email,
                    gitlab_id=gitlab_id,
                    org_id=str(user.org_id),
                    user_id=str(user.id),
                )
        elif not user.gitlab_id:
            user.gitlab_id = gitlab_id
            log.info(
                "oauth.idp_attached_by_email",
                provider="gitlab",
                user_id=str(user.id),
                email=email,
                gitlab_id=gitlab_id,
            )

        db.commit()
        return _oauth_login_redirect(
            user,
            remember_me=_remember_me_from_oauth_state(state),
            request=request,
            db=db,
        )

    except Exception as e:
        log.exception("gitlab.callback_error", error=str(e))
        return _callback_error(state, "gitlab", "server_error")
