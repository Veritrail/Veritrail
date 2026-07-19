from datetime import datetime, timezone

import jwt

from app.core.auth_cookies import REFRESH_COOKIE, attach_refresh_cookie
from app.core.config import get_settings
from app.core.security import decode_refresh_token, issue_mfa_challenge_token, issue_refresh_token
from app.routes.auth_oauth import _remember_me_from_oauth_state
from fastapi import Response


def test_refresh_token_ttl_remember_me():
    settings = get_settings()
    long = decode_refresh_token(issue_refresh_token("u1", "o1", remember_me=True))
    short = decode_refresh_token(issue_refresh_token("u1", "o1", remember_me=False))
    now = datetime.now(timezone.utc).timestamp()
    long_days = (long["exp"] - now) / 86400
    short_hours = (short["exp"] - now) / 3600
    assert long["remember_me"] is True
    assert short["remember_me"] is False
    assert long_days >= settings.AUTH_REFRESH_REMEMBER_DAYS - 0.1
    assert short_hours <= settings.AUTH_REFRESH_SESSION_HOURS + 0.1


def test_mfa_challenge_carries_remember_me():
    raw = issue_mfa_challenge_token("u1", "o1", remember_me=True)
    settings = get_settings()
    payload = jwt.decode(raw, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
    assert payload["type"] == "mfa_challenge"
    assert payload["remember_me"] is True


def test_refresh_cookie_session_vs_persistent():
    settings = get_settings()
    persistent = Response()
    attach_refresh_cookie(persistent, "tok", remember_me=True)
    session = Response()
    attach_refresh_cookie(session, "tok", remember_me=False)
    assert persistent.headers.get("set-cookie", "").startswith(f"{REFRESH_COOKIE}=tok")
    assert f"Max-Age={60 * 60 * 24 * settings.AUTH_REFRESH_REMEMBER_DAYS}" in persistent.headers.get(
        "set-cookie", ""
    )
    session_cookie = session.headers.get("set-cookie", "")
    assert f"Max-Age={60 * 60 * settings.AUTH_REFRESH_SESSION_HOURS}" in session_cookie


def test_oauth_state_remember_me():
    assert _remember_me_from_oauth_state("login") is True
    assert _remember_me_from_oauth_state("login-noremember") is False
