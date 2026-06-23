from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.core.config import get_settings

settings = get_settings()
bearer = HTTPBearer(auto_error=False)


def issue_token(
    sub: str,
    org_id: str,
    ttl_hours: int | None = None,
    scope: str = "user",
) -> str:
    hours = ttl_hours if ttl_hours is not None else settings.AUTH_ACCESS_TOKEN_HOURS
    now = datetime.now(timezone.utc)
    payload = {
        "sub": sub,
        "org_id": org_id,
        "scope": scope,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=hours)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)


def issue_auditor_token(auditor_access_id: str, org_id: str, ttl_hours: int = 24) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": f"auditor:{auditor_access_id}",
        "org_id": org_id,
        "scope": "auditor",
        "auditor_access_id": auditor_access_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=ttl_hours)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)


def issue_refresh_token(sub: str, org_id: str, *, remember_me: bool = False) -> str:
    now = datetime.now(timezone.utc)
    if remember_me:
        expires = now + timedelta(days=settings.AUTH_REFRESH_REMEMBER_DAYS)
    else:
        expires = now + timedelta(hours=settings.AUTH_REFRESH_SESSION_HOURS)
    payload = {
        "type": "refresh",
        "sub": sub,
        "org_id": org_id,
        "remember_me": remember_me,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)


def decode_refresh_token(token: str) -> dict:
    from jose import JWTError
    from fastapi import HTTPException, status
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
    except JWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"invalid refresh token: {e}")
    if payload.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not a refresh token")
    return payload


def issue_mfa_challenge_token(sub: str, org_id: str, *, remember_me: bool = False) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "type": "mfa_challenge",
        "sub": sub,
        "org_id": org_id,
        "remember_me": remember_me,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=5)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)


def decode_mfa_challenge_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
    except JWTError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "MFA session expired — sign in again")
    if payload.get("type") != "mfa_challenge":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "not an mfa challenge token")
    return payload


def issue_password_reset_token(sub: str, fingerprint: str) -> str:
    """Short-lived reset token. `fingerprint` ties it to the current password hash,
    so the token dies the moment the password changes (single-use)."""
    now = datetime.now(timezone.utc)
    payload = {
        "type": "pw_reset",
        "sub": sub,
        "fp": fingerprint,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=30)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)


def decode_password_reset_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
    except JWTError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "reset link expired or invalid — request a new one")
    if payload.get("type") != "pw_reset":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "not a password reset token")
    return payload


def issue_signup_pending_token(email: str, **idp_fields: str) -> str:
    """Short-lived token for SSO users who must create or join a workspace."""
    now = datetime.now(timezone.utc)
    payload: dict = {
        "type": "signup_pending",
        "email": email.strip().lower(),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=15)).timestamp()),
    }
    for key in ("google_id", "github_id", "gitlab_id"):
        value = idp_fields.get(key)
        if value:
            payload[key] = value
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)


def decode_signup_pending_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
    except JWTError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "signup session expired — sign in again")
    if payload.get("type") != "signup_pending":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "not a signup pending token")
    return payload


def current_principal(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    if not creds:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing token")
    try:
        payload = jwt.decode(creds.credentials, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
        if payload.get("type") == "mfa_challenge":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="MFA not verified")
        return payload
    except JWTError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"bad token: {e}")


def current_user_principal(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    """Like current_principal but rejects auditor scopes."""
    principal = current_principal(creds)
    if principal.get("scope") == "auditor":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Auditor scope not permitted for this endpoint")
    return principal


def current_auditor_principal(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    """Requires auditor scope JWT."""
    principal = current_principal(creds)
    if principal.get("scope") != "auditor":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Auditor scope required")
    return principal
