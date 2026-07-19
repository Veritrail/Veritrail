"""Tests for user display name resolution and persistence."""
from __future__ import annotations

import uuid

from app.models.org import Org, User
from app.services.user_display_name import (
    apply_avatar_url_from_profile,
    apply_display_name_if_empty,
    default_display_name_for_email,
    format_email_local_display_name,
    oauth_avatar_fallback_url,
    oauth_avatar_url_from_profile,
    oauth_display_name_from_profile,
    resolve_user_avatar_url,
    resolve_user_display_name,
)


def test_format_email_local_display_name_splits_on_dots_and_underscores():
    assert format_email_local_display_name("elazar.chodjayev@example.com") == "Elazar Chodjayev"
    assert format_email_local_display_name("zenmyx@gmail.com") == "Zenmyx"


def test_oauth_display_name_prefers_full_name():
    assert oauth_display_name_from_profile({"name": "Eliazar Chodjayev"}) == "Eliazar Chodjayev"


def test_oauth_display_name_falls_back_to_given_and_family():
    assert oauth_display_name_from_profile(
        {"given_name": "Eliazar", "family_name": "Chodjayev"}
    ) == "Eliazar Chodjayev"


def test_oauth_avatar_url_prefers_picture_then_avatar_url():
    assert oauth_avatar_url_from_profile(
        {"picture": "https://lh3.googleusercontent.com/a/example"}
    ) == "https://lh3.googleusercontent.com/a/example"
    assert oauth_avatar_url_from_profile(
        {"avatar_url": "https://avatars.githubusercontent.com/u/1"}
    ) == "https://avatars.githubusercontent.com/u/1"
    assert oauth_avatar_url_from_profile({}) is None


def test_apply_avatar_url_from_profile_persists_provider_photo():
    user = User(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        email="zenmyx@gmail.com",
        password_hash="",
    )
    apply_avatar_url_from_profile(
        user,
        {"picture": "https://lh3.googleusercontent.com/a/example"},
    )
    assert user.avatar_url == "https://lh3.googleusercontent.com/a/example"


def test_oauth_avatar_fallback_url_uses_github_id():
    user = User(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        email="elazar.chodjayev@cloud-castles.com",
        password_hash="",
        github_id="96201125",
    )
    assert oauth_avatar_fallback_url(user) == "https://avatars.githubusercontent.com/u/96201125?v=4"


def test_resolve_user_avatar_url_prefers_stored_then_persists_fallback():
    user = User(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        email="elazar.chodjayev@cloud-castles.com",
        password_hash="",
        github_id="96201125",
    )
    assert resolve_user_avatar_url(user) == "https://avatars.githubusercontent.com/u/96201125?v=4"
    assert user.avatar_url is None

    persisted = resolve_user_avatar_url(user, persist_fallback=True)
    assert persisted == "https://avatars.githubusercontent.com/u/96201125?v=4"
    assert user.avatar_url == persisted

    user.avatar_url = "https://lh3.googleusercontent.com/a/stored"
    assert resolve_user_avatar_url(user) == "https://lh3.googleusercontent.com/a/stored"


def test_resolve_user_display_name_priority():
    user = User(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        email="zenmyx@gmail.com",
        password_hash="",
    )
    assert resolve_user_display_name(user) == "Zenmyx"

    user.display_name = "Eliazar Chodjayev"
    assert resolve_user_display_name(user) == "Eliazar Chodjayev"


def test_apply_display_name_if_empty_only_when_missing():
    user = User(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        email="zenmyx@gmail.com",
        password_hash="",
    )
    apply_display_name_if_empty(user, "Eliazar Chodjayev")
    assert user.display_name == "Eliazar Chodjayev"

    apply_display_name_if_empty(user, "Someone Else")
    assert user.display_name == "Eliazar Chodjayev"


def test_default_display_name_for_email_matches_local_part_formatting():
    assert default_display_name_for_email("elazar.chodjayev@example.com") == "Elazar Chodjayev"
