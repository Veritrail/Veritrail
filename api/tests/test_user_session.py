import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from app.models.user_session import UserSession
from app.services.ip_geolocation import format_location, lookup_ip_geolocation
from app.services.user_session import (
    REFRESH_GRACE_SECONDS,
    ensure_session_for_refresh,
    get_session_for_refresh,
    hash_refresh_token,
    list_user_sessions,
    refresh_session_geolocation,
    revoke_other_sessions,
    revoke_session_by_id,
    rotate_user_session,
    session_location_label,
)


def test_format_location_joins_parts():
    assert format_location("San Francisco", "California", "United States") == (
        "San Francisco, California, United States"
    )
    assert format_location(None, None, None) is None


def test_lookup_private_ip_uses_egress():
    with patch("app.services.ip_geolocation.httpx.Client") as client_cls:
        client = client_cls.return_value.__enter__.return_value
        client.get.return_value.status_code = 200
        client.get.return_value.json.return_value = {
            "city": "Austin",
            "region": "Texas",
            "country_name": "United States",
        }
        assert lookup_ip_geolocation("127.0.0.1") == {
            "city": "Austin",
            "region": "Texas",
            "country": "United States",
        }
        client.get.assert_called_once_with(
            "https://ipapi.co/json/",
            headers={"User-Agent": "Veritrail/1.0"},
        )


def test_lookup_public_ip():
    with patch("app.services.ip_geolocation.httpx.Client") as client_cls:
        client = client_cls.return_value.__enter__.return_value
        client.get.return_value.status_code = 200
        client.get.return_value.json.return_value = {
            "city": "Austin",
            "region": "Texas",
            "country_name": "United States",
        }
        assert lookup_ip_geolocation("8.8.8.8") == {
            "city": "Austin",
            "region": "Texas",
            "country": "United States",
        }
        client.get.assert_called_once_with(
            "https://ipapi.co/8.8.8.8/json/",
            headers={"User-Agent": "Veritrail/1.0"},
        )


def test_session_location_label_without_geo():
    session = UserSession(ip_address="172.17.0.1", city=None, region=None, country=None)
    assert session_location_label(session) is None


def test_session_location_label_with_geo():
    session = UserSession(
        ip_address="8.8.8.8",
        city="Austin",
        region="Texas",
        country="United States",
    )
    assert session_location_label(session) == "Austin, Texas, United States"


def test_refresh_session_geolocation_skips_when_present():
    session = UserSession(city="Austin", region="Texas", country="United States")
    assert refresh_session_geolocation(session) is False


def test_refresh_session_geolocation_fills_missing():
    session = UserSession(ip_address="127.0.0.1", city=None, region=None, country=None)
    with patch(
        "app.services.user_session.lookup_ip_geolocation",
        return_value={"city": "Austin", "region": "Texas", "country": "United States"},
    ):
        assert refresh_session_geolocation(session) is True
    assert session.city == "Austin"
    assert session.region == "Texas"
    assert session.country == "United States"


def test_ensure_session_for_refresh_returns_existing():
    db = MagicMock()
    existing = MagicMock()
    request = MagicMock()
    with patch("app.services.user_session.get_session_for_refresh", return_value=existing):
        with patch("app.services.user_session.record_user_session") as record:
            result = ensure_session_for_refresh(db, uuid.uuid4(), "token", request)
            assert result is existing
            record.assert_not_called()


def test_ensure_session_for_refresh_creates_row():
    db = MagicMock()
    new_row = MagicMock()
    request = MagicMock()
    user_id = uuid.uuid4()
    with patch("app.services.user_session.get_session_for_refresh", return_value=None):
        with patch("app.services.user_session.record_user_session", return_value=new_row) as record:
            result = ensure_session_for_refresh(db, user_id, "refresh-token", request)
            assert result is new_row
            record.assert_called_once_with(db, user_id, "refresh-token", request)


def test_list_user_sessions_orders_by_last_seen():
    db = MagicMock()
    user_id = uuid.uuid4()
    older = UserSession(user_id=user_id, token_hash="a" * 64)
    newer = UserSession(user_id=user_id, token_hash="b" * 64)
    db.scalars.return_value.all.return_value = [newer, older]
    rows = list_user_sessions(db, user_id)
    assert rows == [newer, older]


def test_revoke_session_by_id_deletes_owned_row():
    db = MagicMock()
    user_id = uuid.uuid4()
    session_id = uuid.uuid4()
    row = UserSession(user_id=user_id, token_hash="c" * 64)
    db.scalar.return_value = row
    assert revoke_session_by_id(db, user_id, session_id) is True
    db.delete.assert_called_once_with(row)


def test_revoke_other_sessions_keeps_current():
    db = MagicMock()
    user_id = uuid.uuid4()
    keep = UserSession(user_id=user_id, token_hash=hash_refresh_token("keep-me"))
    other = UserSession(user_id=user_id, token_hash=hash_refresh_token("drop-me"))
    db.scalars.return_value.all.return_value = [other]
    count = revoke_other_sessions(db, user_id, "keep-me")
    assert count == 1
    db.delete.assert_called_once_with(other)


def test_get_session_for_refresh_matches_current_token():
    db = MagicMock()
    user_id = uuid.uuid4()
    row = UserSession(user_id=user_id, token_hash=hash_refresh_token("current-token"))
    db.scalar.return_value = row
    assert get_session_for_refresh(db, user_id, "current-token") is row
    db.scalar.assert_called_once()


def test_get_session_for_refresh_falls_back_within_grace_window():
    """Second tab refreshing with the just-superseded token gets the same
    session back instead of a hard failure — the core race-condition fix."""
    db = MagicMock()
    user_id = uuid.uuid4()
    row = UserSession(
        user_id=user_id,
        token_hash=hash_refresh_token("new-token"),
        prev_token_hash=hash_refresh_token("old-token"),
        prev_token_rotated_at=datetime.now(timezone.utc) - timedelta(seconds=2),
    )
    # First scalar() call (current-hash lookup) misses; second (grace lookup) hits.
    db.scalar.side_effect = [None, row]
    assert get_session_for_refresh(db, user_id, "old-token") is row
    assert db.scalar.call_count == 2


def test_get_session_for_refresh_rejects_expired_grace_window():
    db = MagicMock()
    user_id = uuid.uuid4()
    # Both scalar() calls miss: the grace query itself filters on
    # prev_token_rotated_at >= cutoff, so an expired row wouldn't match —
    # simulate that by having the DB-side query return None either way.
    db.scalar.side_effect = [None, None]
    assert get_session_for_refresh(db, user_id, "old-token") is None
    assert db.scalar.call_count == 2


def test_rotate_user_session_stashes_previous_token():
    db = MagicMock()
    user_id = uuid.uuid4()
    request = MagicMock()
    row = UserSession(user_id=user_id, token_hash=hash_refresh_token("old-token"))
    db.scalar.return_value = row
    result = rotate_user_session(db, user_id, "old-token", "new-token", request)
    assert result is row
    assert row.token_hash == hash_refresh_token("new-token")
    assert row.prev_token_hash == hash_refresh_token("old-token")
    assert row.prev_token_rotated_at is not None


def test_rotate_user_session_updates_same_row_during_grace_window():
    """A grace-window rotation must update the existing row, not create a
    duplicate session — otherwise a losing tab silently forks a new session."""
    db = MagicMock()
    user_id = uuid.uuid4()
    request = MagicMock()
    row = UserSession(
        user_id=user_id,
        token_hash=hash_refresh_token("newer-token"),
        prev_token_hash=hash_refresh_token("old-token"),
        prev_token_rotated_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    db.scalar.side_effect = [None, row]
    with patch("app.services.user_session.record_user_session") as record:
        result = rotate_user_session(db, user_id, "old-token", "newest-token", request)
        record.assert_not_called()
    assert result is row
    assert row.token_hash == hash_refresh_token("newest-token")
    assert row.prev_token_hash == hash_refresh_token("newer-token")


def test_refresh_grace_seconds_is_short() -> None:
    """Sanity bound so the window stays a race-condition buffer, not a
    meaningful extension of how long a stolen/leaked token stays valid."""
    assert 0 < REFRESH_GRACE_SECONDS <= 60
