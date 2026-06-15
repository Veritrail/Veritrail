import uuid
from unittest.mock import MagicMock, patch

from app.models.user_session import UserSession
from app.services.ip_geolocation import format_location, lookup_ip_geolocation
from app.services.user_session import (
    ensure_session_for_refresh,
    refresh_session_geolocation,
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
            headers={"User-Agent": "Vigil/1.0"},
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
            headers={"User-Agent": "Vigil/1.0"},
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
