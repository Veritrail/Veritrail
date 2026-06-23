"""Slack + Jira integration helpers and alert delivery."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.services.jira_client import normalize_site_url
from app.services.scan_alert import _post_scan_failure_slack, notify_scan_failure


def test_normalize_site_url_accepts_host_only():
    assert normalize_site_url("acme.atlassian.net") == "https://acme.atlassian.net"


def test_normalize_site_url_rejects_http():
    with pytest.raises(ValueError, match="https"):
        normalize_site_url("http://acme.atlassian.net")


def test_post_scan_failure_slack_posts_message():
    with patch("app.services.scan_alert.httpx.post") as post:
        post.return_value = MagicMock(status_code=200, raise_for_status=MagicMock())
        ok = _post_scan_failure_slack(
            "https://hooks.slack.com/services/T/B/X",
            "prod",
            "collect_iam",
            "ClientError",
            "Access denied",
        )
    assert ok is True
    post.assert_called_once()
    body = post.call_args.kwargs["json"]["text"]
    assert "scan failed" in body.lower()
    assert "prod" in body


def test_notify_scan_failure_slack_only_when_enabled():
    org_id = uuid.uuid4()
    acc_id = uuid.uuid4()
    run_id = uuid.uuid4()

    org = MagicMock()
    org.id = org_id
    org.name = "Acme"
    org.settings = {
        "notifications": {
            "scan_failure_email_enabled": False,
            "slack_webhook_url": "https://hooks.slack.com/services/T/B/X",
            "slack_scan_failure_enabled": True,
        }
    }

    acc = MagicMock()
    acc.id = acc_id
    acc.org_id = org_id
    acc.label = "prod"
    acc.account_id = "123456789012"

    run = MagicMock()
    run.id = run_id
    run.status = "error"
    run.error = "boom"
    run.stats = {"failed_at": "checks", "error_type": "Error"}

    db = MagicMock()
    db.get.side_effect = lambda model, pk: {
        acc_id: acc,
        run_id: run,
        org_id: org,
    }.get(pk)

    with patch("app.services.scan_alert._post_scan_failure_slack", return_value=True) as slack:
        sent = notify_scan_failure(db, acc_id, run_id)

    assert sent is True
    slack.assert_called_once()
