"""HttpOnly refresh-token cookies (access token stays in SPA memory)."""
from __future__ import annotations

from fastapi import Request, Response

from app.core.config import get_settings

REFRESH_COOKIE = "veritrail_refresh"


def refresh_cookie_enabled() -> bool:
    return get_settings().APP_ENV != "test"


def attach_refresh_cookie(
    response: Response,
    refresh_token: str,
    *,
    remember_me: bool = False,
) -> None:
    if not refresh_cookie_enabled():
        return
    settings = get_settings()
    secure = settings.APP_ENV != "dev"
    cookie_kwargs: dict = {
        "key": REFRESH_COOKIE,
        "value": refresh_token,
        "httponly": True,
        "secure": secure,
        "samesite": "lax",
        "path": "/v1/auth",
    }
    if remember_me:
        cookie_kwargs["max_age"] = 60 * 60 * 24 * settings.AUTH_REFRESH_REMEMBER_DAYS
    else:
        # Match JWT session TTL so the cookie survives page reloads (browser
        # "session" cookies without Max-Age are not a reliable restore surface).
        cookie_kwargs["max_age"] = 60 * 60 * settings.AUTH_REFRESH_SESSION_HOURS
    response.set_cookie(**cookie_kwargs)


def clear_refresh_cookie(response: Response) -> None:
    if not refresh_cookie_enabled():
        return
    settings = get_settings()
    secure = settings.APP_ENV != "dev"
    response.delete_cookie(
        key=REFRESH_COOKIE,
        path="/v1/auth",
        httponly=True,
        secure=secure,
        samesite="lax",
    )


def refresh_token_from_request(request: Request, body_token: str | None) -> str | None:
    if body_token:
        return body_token
    return request.cookies.get(REFRESH_COOKIE)
