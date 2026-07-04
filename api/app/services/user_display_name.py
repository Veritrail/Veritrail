"""Resolve and persist human-readable user display names."""
from __future__ import annotations

import re

from app.models.org import User


def format_email_local_display_name(email: str) -> str:
    """Turn elazar.chodjayev@example.com into 'Elazar Chodjayev'."""
    local = (email.split("@")[0] or email).strip()
    parts = [part for part in re.split(r"[._\-+]+", local) if part]
    if len(parts) >= 2:
        return " ".join(part.capitalize() for part in parts)
    if local:
        return local[0].upper() + local[1:]
    return email


def oauth_display_name_from_profile(profile: dict) -> str | None:
    """Extract a display name from an OAuth userinfo/profile payload."""
    name = (profile.get("name") or "").strip()
    if name:
        return name
    given = (profile.get("given_name") or "").strip()
    family = (profile.get("family_name") or "").strip()
    combined = f"{given} {family}".strip()
    return combined or None


def resolve_user_display_name(user: User) -> str:
    """display_name > formatted email local part > full email."""
    stored = (user.display_name or "").strip()
    if stored:
        return stored
    return format_email_local_display_name(user.email)


def apply_display_name_if_empty(user: User, display_name: str | None) -> None:
    """Persist provider-supplied name when the user has none stored."""
    candidate = (display_name or "").strip()
    if candidate and not (user.display_name or "").strip():
        user.display_name = candidate


def default_display_name_for_email(email: str) -> str:
    """Default display name for email/password signups."""
    return format_email_local_display_name(email)
