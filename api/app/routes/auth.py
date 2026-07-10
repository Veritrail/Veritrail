import hashlib
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.passwords import hash_password, pwned_count, verify_password
from app.core.ratelimit import limiter
from app.core.mfa_lockout import check_mfa_lock, clear_mfa_lockout, record_mfa_failure
from app.core.security import (
    current_principal,
    current_user_principal,
    decode_mfa_challenge_token,
    decode_password_reset_token,
    decode_refresh_token,
    decode_signup_pending_token,
    issue_mfa_challenge_token,
    issue_password_reset_token,
    issue_refresh_token,
    issue_token,
)
from app.core.auth_cookies import (
    attach_refresh_cookie,
    clear_refresh_cookie,
    refresh_cookie_enabled,
    refresh_token_from_request,
)
from app.core.totp import new_secret, provisioning_uri, qr_png_data_url, verify_totp
from app.models import Org, User
from app.models.user_session import UserSession
from app.core.config import get_settings
from app.services.password_reset_email import send_password_reset_email
from app.services.user_display_name import default_display_name_for_email, resolve_user_display_name
from app.services.user_session import (
    ensure_session_for_refresh,
    refresh_session_geolocation,
    get_session_for_refresh,
    list_user_sessions,
    record_user_session,
    revoke_other_sessions,
    revoke_session_by_id,
    revoke_session_for_refresh,
    rotate_user_session,
    session_location_label,
)

router = APIRouter()
settings = get_settings()

# Self-registration is disabled — accounts are created via workspace invites
# (or SSO/SAML into an existing workspace). Marketing "request access" goes to
# support@veritrail.io.
SIGNUPS_DISABLED_MESSAGE = "Signups are invite-only — contact support@veritrail.io"


def _normalize_backup_code(code: str) -> str:
    return "".join(c for c in code.lower() if c.isalnum())


def _hash_backup_code(code: str) -> str:
    return hashlib.sha256(_normalize_backup_code(code).encode()).hexdigest()


def _generate_backup_codes(n: int = 10) -> list[str]:
    return [f"{secrets.token_hex(3)}-{secrets.token_hex(3)}" for _ in range(n)]


class SignupIn(BaseModel):
    email: EmailStr
    password: str
    org_name: str = ""
    invite_token: str | None = None

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 12:
            raise ValueError("password must be at least 12 characters")
        count = pwned_count(v)
        if count > 0:
            raise ValueError(f"password has appeared in {count:,} data breaches — choose a different password")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    remember_me: bool = True


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str = ""
    org_id: str


def _token_json_response(
    access_token: str,
    refresh_token: str,
    org_id: str,
    *,
    remember_me: bool = False,
) -> JSONResponse:
    """Access token in JSON; refresh in HttpOnly cookie when enabled."""
    payload: dict = {"access_token": access_token, "org_id": org_id}
    if not refresh_cookie_enabled():
        payload["refresh_token"] = refresh_token
    else:
        payload["refresh_token"] = ""
    resp = JSONResponse(content=payload)
    attach_refresh_cookie(resp, refresh_token, remember_me=remember_me)
    return resp


def _issue_login_tokens(
    request: Request,
    db: Session,
    user: User,
    *,
    remember_me: bool = False,
    auth_method: str = "password",
) -> JSONResponse:
    from app.models.org import Org
    from app.services.org_sso_policy import assert_password_auth_allowed

    org = db.get(Org, user.org_id)
    if auth_method == "password" and org:
        assert_password_auth_allowed(org)

    uid, oid = str(user.id), str(user.org_id)
    access = issue_token(uid, oid)
    refresh = issue_refresh_token(uid, oid, remember_me=remember_me)
    record_user_session(db, user.id, refresh, request, auth_method=auth_method)
    db.commit()
    return _token_json_response(access, refresh, oid, remember_me=remember_me)


class LoginOut(BaseModel):
    access_token: str | None = None
    refresh_token: str | None = None
    org_id: str | None = None
    mfa_required: bool = False
    mfa_token: str | None = None


def _login_response(user: User, *, remember_me: bool = False) -> LoginOut:
    uid, oid = str(user.id), str(user.org_id)
    if user.totp_enabled:
        return LoginOut(
            mfa_required=True,
            mfa_token=issue_mfa_challenge_token(uid, oid, remember_me=remember_me),
        )
    return LoginOut(
        access_token=issue_token(uid, oid),
        refresh_token=issue_refresh_token(uid, oid, remember_me=remember_me),
        org_id=oid,
    )


class RefreshIn(BaseModel):
    refresh_token: str = ""


class CompleteSignupIn(BaseModel):
    signup_token: str
    org_name: str = ""
    invite_token: str | None = None


class WorkspaceOut(BaseModel):
    org_id: str
    org_name: str
    role: str


class WorkspaceSwitchIn(BaseModel):
    org_id: str


@router.post("/signup")
@limiter.limit("5/minute")
def signup(request: Request, body: SignupIn, db: Session = Depends(get_db)):
    """Create an account from a workspace invite. Public self-registration is disabled."""
    from app.services.org_invites import consume_invite_for_signup
    from app.services.org_activity import log_org_activity
    from app.services.org_membership import add_membership

    if not body.invite_token:
        raise HTTPException(status.HTTP_403_FORBIDDEN, SIGNUPS_DISABLED_MESSAGE)

    if db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")

    org, role = consume_invite_for_signup(db, body.invite_token, str(body.email))
    user = User(
        id=uuid.uuid4(),
        org_id=org.id,
        email=str(body.email).lower(),
        display_name=default_display_name_for_email(str(body.email)),
        password_hash=hash_password(body.password),
        role=role,
    )
    db.add(user)
    add_membership(db, user.id, org.id, role)
    log_org_activity(
        db,
        org_id=org.id,
        actor_user_id=user.id,
        action="member.invite_accepted",
        target_type="user",
        target_id=str(user.id),
        detail={"email": user.email, "role": role},
    )

    db.commit()
    return _issue_login_tokens(request, db, user, remember_me=True)


@router.post("/complete-signup")
@limiter.limit("10/minute")
def complete_signup(request: Request, body: CompleteSignupIn, db: Session = Depends(get_db)):
    """Finish SSO sign-up from a workspace invite. New-workspace creation is disabled."""
    from app.services.org_invites import consume_invite_for_signup
    from app.services.org_activity import log_org_activity
    from app.services.org_membership import add_membership

    if not body.invite_token:
        raise HTTPException(status.HTTP_403_FORBIDDEN, SIGNUPS_DISABLED_MESSAGE)

    payload = decode_signup_pending_token(body.signup_token)
    email = payload["email"]
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")

    identity_fields: dict[str, str] = {}
    for field in ("google_id", "github_id", "gitlab_id", "display_name"):
        if payload.get(field):
            identity_fields[field] = payload[field]
    if "display_name" not in identity_fields:
        identity_fields["display_name"] = default_display_name_for_email(email)

    org, role = consume_invite_for_signup(db, body.invite_token, email)
    user = User(
        id=uuid.uuid4(),
        org_id=org.id,
        email=email,
        password_hash="",
        role=role,
        **identity_fields,
    )
    db.add(user)
    add_membership(db, user.id, org.id, role)
    log_org_activity(
        db,
        org_id=org.id,
        actor_user_id=user.id,
        action="member.invite_accepted",
        target_type="user",
        target_id=str(user.id),
        detail={"email": user.email, "role": role, "via": "sso_complete_signup"},
    )

    db.commit()
    return _issue_login_tokens(request, db, user, remember_me=True)


@router.get("/workspaces", response_model=list[WorkspaceOut])
def list_workspaces(
    principal: dict = Depends(current_user_principal),
    db: Session = Depends(get_db),
):
    from app.core.rbac import normalize_role
    from app.services.org_membership import list_memberships

    user = db.get(User, uuid.UUID(principal["sub"]))
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    return [
        WorkspaceOut(
            org_id=str(org.id),
            org_name=org.name or "Workspace",
            role=normalize_role(membership.role),
        )
        for membership, org in list_memberships(db, user.id)
    ]


@router.post("/workspaces/switch")
@limiter.limit("30/minute")
def switch_workspace(
    request: Request,
    body: WorkspaceSwitchIn,
    principal: dict = Depends(current_user_principal),
    db: Session = Depends(get_db),
):
    from app.models.org import Org
    from app.services.org_sso_policy import assert_session_allowed_for_org

    user = db.get(User, uuid.UUID(principal["sub"]))
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    try:
        org_uuid = uuid.UUID(body.org_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid org_id") from exc

    raw = refresh_token_from_request(request, None)
    session = get_session_for_refresh(db, user.id, raw) if raw else None
    target_org = db.get(Org, org_uuid)
    if target_org:
        assert_session_allowed_for_org(target_org, session)

    from app.services.org_membership import set_active_workspace

    set_active_workspace(db, user, org_uuid)
    db.commit()
    auth_method = session.auth_method if session and session.auth_method else "password"
    return _issue_login_tokens(request, db, user, remember_me=True, auth_method=auth_method)


@router.post("/login", response_model=LoginOut)
@limiter.limit("10/minute")
def login(request: Request, body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email))
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad credentials")
    from app.models.org import Org
    from app.services.org_sso_policy import assert_password_auth_allowed

    org = db.get(Org, user.org_id)
    if org:
        assert_password_auth_allowed(org)
    out = _login_response(user, remember_me=body.remember_me)
    if out.mfa_required:
        return out
    return _issue_login_tokens(request, db, user, remember_me=body.remember_me, auth_method="password")


class MfaVerifyIn(BaseModel):
    mfa_token: str
    code: str


@router.post("/mfa/verify")
@limiter.limit("30/minute")
def mfa_verify(request: Request, body: MfaVerifyIn, db: Session = Depends(get_db)):
    payload = decode_mfa_challenge_token(body.mfa_token)
    user_id = payload["sub"]
    check_mfa_lock(user_id)
    user = db.get(User, uuid.UUID(user_id))
    if not user or not user.totp_enabled or not user.totp_secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "MFA not configured")
    if not verify_totp(user.totp_secret, body.code):
        # Fall back to a one-time backup (recovery) code, then consume it.
        code_hash = _hash_backup_code(body.code)
        backup = list(user.mfa_backup_codes or [])
        if code_hash in backup:
            backup.remove(code_hash)
            user.mfa_backup_codes = backup
            db.commit()
        else:
            record_mfa_failure(user_id)
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid code")
    clear_mfa_lockout(user_id)
    remember_me = bool(payload.get("remember_me"))
    return _issue_login_tokens(request, db, user, remember_me=remember_me)


class MfaCodeIn(BaseModel):
    code: str


class MfaSetupOut(BaseModel):
    secret: str
    provisioning_uri: str
    qr_data_url: str | None = None


@router.post("/me/mfa/setup", response_model=MfaSetupOut)
def mfa_setup(principal: dict = Depends(current_principal), db: Session = Depends(get_db)):
    user = db.get(User, uuid.UUID(principal["sub"]))
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    if user.totp_enabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "MFA is already enabled")
    secret = new_secret()
    user.totp_secret = secret
    db.commit()
    uri = provisioning_uri(user.email, secret)
    return MfaSetupOut(
        secret=secret,
        provisioning_uri=uri,
        qr_data_url=qr_png_data_url(uri),
    )


@router.post("/me/mfa/enable", status_code=204)
def mfa_enable(
    body: MfaCodeIn,
    principal: dict = Depends(current_principal),
    db: Session = Depends(get_db),
):
    user = db.get(User, uuid.UUID(principal["sub"]))
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    if user.totp_enabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "MFA is already enabled")
    if not user.totp_secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "call setup first")
    if not verify_totp(user.totp_secret, body.code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid code")
    user.totp_enabled = True
    db.commit()


class MfaDisableIn(BaseModel):
    code: str
    password: str | None = None


@router.post("/me/mfa/disable", status_code=204)
def mfa_disable(
    body: MfaDisableIn,
    principal: dict = Depends(current_principal),
    db: Session = Depends(get_db),
):
    user = db.get(User, uuid.UUID(principal["sub"]))
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    if not user.totp_enabled or not user.totp_secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "MFA is not enabled")
    if not verify_totp(user.totp_secret, body.code):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid code")
    if user.password_hash:
        if not body.password or not verify_password(body.password, user.password_hash):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "password incorrect")
    user.totp_enabled = False
    user.totp_secret = None
    user.mfa_backup_codes = None
    db.commit()


class BackupCodesOut(BaseModel):
    codes: list[str]


@router.post("/me/mfa/backup-codes", response_model=BackupCodesOut)
def generate_mfa_backup_codes(
    principal: dict = Depends(current_principal),
    db: Session = Depends(get_db),
):
    """Generate 10 one-time recovery codes (replaces any existing set). Shown once."""
    user = db.get(User, uuid.UUID(principal["sub"]))
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    if not user.totp_enabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "enable two-factor authentication first")
    codes = _generate_backup_codes(10)
    user.mfa_backup_codes = [_hash_backup_code(c) for c in codes]
    db.commit()
    return BackupCodesOut(codes=codes)


@router.post("/refresh")
def refresh(request: Request, body: RefreshIn, db: Session = Depends(get_db)):
    from app.models.org import Org
    from app.services.org_sso_policy import assert_session_allowed_for_org

    raw = refresh_token_from_request(request, body.refresh_token)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing refresh token")
    payload = decode_refresh_token(raw)
    user = db.get(User, uuid.UUID(payload["sub"]))
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user not found")
    session = get_session_for_refresh(db, user.id, raw)
    if not session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session ended — sign in again")
    org = db.get(Org, user.org_id)
    if org:
        assert_session_allowed_for_org(org, session)
    uid, oid = str(user.id), str(user.org_id)
    remember_me = bool(payload.get("remember_me"))
    new_refresh = issue_refresh_token(uid, oid, remember_me=remember_me)
    rotate_user_session(db, user.id, raw, new_refresh, request)
    db.commit()
    return _token_json_response(
        issue_token(uid, oid),
        new_refresh,
        oid,
        remember_me=remember_me,
    )


@router.post("/logout", status_code=204)
def logout(request: Request, db: Session = Depends(get_db)):
    raw = refresh_token_from_request(request, None)
    if raw:
        revoke_session_for_refresh(db, raw)
        db.commit()
    resp = Response(status_code=204)
    clear_refresh_cookie(resp)
    return resp


class MeOut(BaseModel):
    id: str
    email: str
    display_name: str
    role: str
    evidence_role: str
    org_id: str
    org_name: str
    has_workspace: bool
    github_id: str | None
    gitlab_id: str | None
    google_id: str | None
    totp_enabled: bool
    has_password: bool
    mfa_backup_codes_remaining: int = 0
    platform_admin: bool = False


class SessionOut(BaseModel):
    location: str | None = None
    signed_in_at: str | None = None


class SessionListItemOut(BaseModel):
    id: str
    user_agent: str | None = None
    location: str | None = None
    signed_in_at: str | None = None
    last_seen_at: str | None = None
    current: bool = False


def _session_list_item(row: UserSession, *, current: bool) -> SessionListItemOut:
    return SessionListItemOut(
        id=str(row.id),
        user_agent=row.user_agent,
        location=session_location_label(row),
        signed_in_at=row.created_at.isoformat() if row.created_at else None,
        last_seen_at=row.last_seen_at.isoformat() if row.last_seen_at else None,
        current=current,
    )


def _current_refresh_hash(request: Request) -> str | None:
    from app.services.user_session import hash_refresh_token

    raw = refresh_token_from_request(request, None)
    if not raw:
        return None
    return hash_refresh_token(raw)


def get_current_user(
    principal: dict = Depends(current_user_principal),
    db: Session = Depends(get_db),
) -> User:
    """Load the authenticated user row (compliance/meta routes)."""
    user = db.get(User, uuid.UUID(principal["sub"]))
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    return user


@router.get("/me", response_model=MeOut)
def get_me(principal: dict = Depends(current_principal), db: Session = Depends(get_db)):
    from app.core.evidence_rbac import membership_evidence_role
    from app.core.rbac import normalize_role
    from app.routes.platform_admin import is_platform_admin as _is_platform_admin
    from app.services.org_membership import list_memberships

    user = db.get(User, uuid.UUID(principal["sub"]))
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user not found")
    has_workspace = bool(list_memberships(db, user.id))
    org = db.get(Org, user.org_id)
    return MeOut(
        id=str(user.id),
        email=user.email,
        display_name=resolve_user_display_name(user),
        role=normalize_role(user.role),
        evidence_role=membership_evidence_role(
            db, user.id, user.org_id, fallback_org_role=user.role
        ),
        org_id=str(user.org_id),
        org_name=(org.name if org else None) or "Workspace",
        has_workspace=has_workspace,
        github_id=user.github_id,
        gitlab_id=user.gitlab_id,
        google_id=user.google_id,
        totp_enabled=user.totp_enabled,
        has_password=bool(user.password_hash),
        mfa_backup_codes_remaining=len(user.mfa_backup_codes or []),
        platform_admin=_is_platform_admin(user.email),
    )


@router.get("/me/session", response_model=SessionOut)
def get_my_session(
    request: Request,
    principal: dict = Depends(current_principal),
    db: Session = Depends(get_db),
):
    user_id = uuid.UUID(principal["sub"])
    raw = refresh_token_from_request(request, None)
    if not raw:
        return SessionOut()
    row = get_session_for_refresh(db, user_id, raw)
    if not row:
        row = ensure_session_for_refresh(db, user_id, raw, request)
        db.commit()
    elif refresh_session_geolocation(row):
        db.commit()
    return SessionOut(
        location=session_location_label(row),
        signed_in_at=row.created_at.isoformat() if row.created_at else None,
    )


@router.get("/me/sessions", response_model=list[SessionListItemOut])
def list_my_sessions(
    request: Request,
    principal: dict = Depends(current_principal),
    db: Session = Depends(get_db),
):
    user_id = uuid.UUID(principal["sub"])
    current_hash = _current_refresh_hash(request)
    rows = list_user_sessions(db, user_id)
    return [
        _session_list_item(row, current=bool(current_hash and row.token_hash == current_hash))
        for row in rows
    ]


@router.delete("/me/sessions/{session_id}", status_code=204)
def revoke_my_session(
    session_id: uuid.UUID,
    request: Request,
    principal: dict = Depends(current_principal),
    db: Session = Depends(get_db),
):
    user_id = uuid.UUID(principal["sub"])
    current_hash = _current_refresh_hash(request)
    target = db.scalar(
        select(UserSession).where(UserSession.id == session_id, UserSession.user_id == user_id)
    )
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "session not found")
    if current_hash and target.token_hash == current_hash:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "use sign out for this device")
    if not revoke_session_by_id(db, user_id, session_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "session not found")
    db.commit()


@router.post("/me/sessions/revoke-others", status_code=204)
def revoke_other_my_sessions(
    request: Request,
    principal: dict = Depends(current_principal),
    db: Session = Depends(get_db),
):
    user_id = uuid.UUID(principal["sub"])
    raw = refresh_token_from_request(request, None)
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no active session on this device")
    revoke_other_sessions(db, user_id, raw)
    db.commit()


class ChangePasswordIn(BaseModel):
    current_password: str | None = None
    new_password: str


@router.put("/me/password", status_code=204)
def change_password(
    body: ChangePasswordIn,
    principal: dict = Depends(current_principal),
    db: Session = Depends(get_db),
):
    from app.services.org_sso_policy import assert_password_auth_allowed_for_user

    user = db.get(User, uuid.UUID(principal["sub"]))
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    assert_password_auth_allowed_for_user(db, user)
    if user.password_hash:
        # existing password — must verify current
        if not body.current_password or not verify_password(body.current_password, user.password_hash):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "current password incorrect")
    if len(body.new_password) < 12:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "password must be at least 12 characters")
    count = pwned_count(body.new_password)
    if count > 0:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"password has appeared in {count:,} data breaches — choose a different password",
        )
    user.password_hash = hash_password(body.new_password)
    db.commit()


def _password_fingerprint(user: User) -> str:
    """Stable tag of the current password hash; changes when the password changes,
    so a reset token signed against it can only be used once."""
    return hashlib.sha256((user.password_hash or "").encode()).hexdigest()[:16]


class PasswordResetRequestIn(BaseModel):
    email: EmailStr


@router.post("/password-reset/request", status_code=204)
@limiter.limit("5/minute")
def password_reset_request(request: Request, body: PasswordResetRequestIn, db: Session = Depends(get_db)):
    from app.models.org import Org
    from app.services.org_sso_policy import org_sso_required

    user = db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if user:
        org = db.get(Org, user.org_id)
        if not org or not org_sso_required(org):
            token = issue_password_reset_token(str(user.id), _password_fingerprint(user))
            reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
            send_password_reset_email(to=user.email, reset_url=reset_url)
    # Always 204 — never reveal whether an account exists for this email.
    return Response(status_code=204)


class PasswordResetConfirmIn(BaseModel):
    token: str
    new_password: str


@router.post("/password-reset/confirm", status_code=204)
def password_reset_confirm(body: PasswordResetConfirmIn, db: Session = Depends(get_db)):
    from app.services.org_sso_policy import assert_password_auth_allowed_for_user

    payload = decode_password_reset_token(body.token)
    user = db.get(User, uuid.UUID(payload["sub"]))
    if not user or payload.get("fp") != _password_fingerprint(user):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "reset link expired or already used — request a new one")
    assert_password_auth_allowed_for_user(db, user)
    if len(body.new_password) < 12:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "password must be at least 12 characters")
    count = pwned_count(body.new_password)
    if count > 0:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"password has appeared in {count:,} data breaches — choose a different password",
        )
    user.password_hash = hash_password(body.new_password)
    db.commit()
    return Response(status_code=204)


def _remaining_signin_methods(user: User, *, excluding: str) -> int:
    """Count sign-in methods that will remain after disconnecting `excluding`."""
    count = 1 if user.password_hash else 0
    if excluding != "github" and user.github_id:
        count += 1
    if excluding != "gitlab" and user.gitlab_id:
        count += 1
    if excluding != "google" and user.google_id:
        count += 1
    return count


@router.delete("/me/github", status_code=204)
def disconnect_github(
    principal: dict = Depends(current_principal),
    db: Session = Depends(get_db),
):
    user = db.get(User, uuid.UUID(principal["sub"]))
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    if _remaining_signin_methods(user, excluding="github") == 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "set a password or connect another sign-in method before disconnecting GitHub",
        )
    user.github_id = None
    db.commit()


@router.delete("/me/gitlab", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_gitlab(
    principal: dict = Depends(current_principal),
    db: Session = Depends(get_db),
):
    user = db.get(User, uuid.UUID(principal["sub"]))
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    if _remaining_signin_methods(user, excluding="gitlab") == 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "set a password or connect another sign-in method before disconnecting GitLab",
        )
    user.gitlab_id = None
    db.commit()


@router.delete("/me/google", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_google(
    principal: dict = Depends(current_principal),
    db: Session = Depends(get_db),
):
    user = db.get(User, uuid.UUID(principal["sub"]))
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    if _remaining_signin_methods(user, excluding="google") == 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "set a password or connect another sign-in method before disconnecting Google",
        )
    user.google_id = None
    db.commit()
