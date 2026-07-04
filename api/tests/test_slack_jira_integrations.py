"""Slack + Jira integration helpers and alert delivery."""
from __future__ import annotations

import uuid
import json
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.routes.jira_integration import _issue_description, list_jira_projects
from app.services.jira_client import JiraClient, normalize_site_url
from app.services.scan_alert import _post_scan_failure_slack, notify_scan_failure


def test_normalize_site_url_accepts_host_only():
    assert normalize_site_url("acme.atlassian.net") == "https://acme.atlassian.net"


def test_normalize_site_url_rejects_http():
    with pytest.raises(ValueError, match="https"):
        normalize_site_url("http://acme.atlassian.net")


def test_jira_verify_without_project_key_checks_myself_only():
    captured: list[str] = []

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, path):
            captured.append(path)
            return MagicMock(
                status_code=200,
                json=MagicMock(return_value={"accountId": "abc", "displayName": "Ops Bot"}),
                raise_for_status=MagicMock(),
            )

    client = JiraClient(site_url="acme.atlassian.net", email="ops@example.com", api_token="token")
    with patch.object(client, "_client", return_value=FakeClient()):
        result = client.verify()

    assert captured == ["/myself"]
    assert result == {"account_id": "abc", "display_name": "Ops Bot"}


def test_jira_verify_with_project_key_checks_project():
    captured: list[str] = []

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, path):
            captured.append(path)
            if path == "/myself":
                payload = {"accountId": "abc", "displayName": "Ops Bot"}
            else:
                payload = {"key": "KAN", "name": "Kanban"}
            return MagicMock(
                status_code=200,
                json=MagicMock(return_value=payload),
                raise_for_status=MagicMock(),
            )

    client = JiraClient(site_url="acme.atlassian.net", email="ops@example.com", api_token="token")
    with patch.object(client, "_client", return_value=FakeClient()):
        result = client.verify("kan")

    assert captured == ["/myself", "/project/KAN"]
    assert result["project_key"] == "KAN"
    assert result["project_name"] == "Kanban"


def test_jira_create_issue_sends_priority_assignee_and_structured_description():
    captured = {}

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, path, *, content):
            captured["path"] = path
            captured["payload"] = json.loads(content)
            return MagicMock(
                status_code=201,
                json=MagicMock(return_value={"key": "KAN-1", "id": "10001"}),
                raise_for_status=MagicMock(),
            )

    client = JiraClient(site_url="acme.atlassian.net", email="ops@example.com", api_token="token")
    with patch.object(client, "_client", return_value=FakeClient()):
        issue = client.create_issue(
            project_key="KAN",
            summary="Fix least privilege",
            description="Opened from Veritrail\nSeverity: HIGH\n\nRecommended remediation\nScope the policy",
            labels=["veritrail", "high"],
            priority="High",
            assignee_account_id="abc123",
        )

    assert issue["issue_key"] == "KAN-1"
    fields = captured["payload"]["fields"]
    assert fields["priority"] == {"name": "High"}
    assert fields["assignee"] == {"accountId": "abc123"}
    assert fields["labels"] == ["veritrail", "high"]
    assert len(fields["description"]["content"]) == 2
    assert fields["description"]["content"][0]["content"][1]["type"] == "hardBreak"


def test_jira_list_projects_paginates_and_maps_keys():
    captured: list[dict] = []

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, path, *, params):
            captured.append({"path": path, "params": params})
            if params.get("startAt", 0) == 0:
                return MagicMock(
                    status_code=200,
                    json=MagicMock(
                        return_value={
                            "values": [
                                {"key": "KAN", "name": "Kanban", "id": "10000"},
                                {"key": "SEC", "name": "Security", "id": "10001"},
                            ],
                            "total": 2,
                        }
                    ),
                    raise_for_status=MagicMock(),
                )
            return MagicMock(
                status_code=200,
                json=MagicMock(return_value={"values": [], "total": 2}),
                raise_for_status=MagicMock(),
            )

    client = JiraClient(site_url="acme.atlassian.net", email="ops@example.com", api_token="token")
    with patch.object(client, "_client", return_value=FakeClient()):
        projects = client.list_projects()

    assert captured[0]["path"] == "/project/search"
    assert projects == [
        {"key": "KAN", "name": "Kanban", "id": "10000"},
        {"key": "SEC", "name": "Security", "id": "10001"},
    ]


def test_list_jira_projects_route_returns_connected_projects(mock_db, monkeypatch):
    org_id = uuid.uuid4()
    provider = MagicMock()
    provider.status = "connected"

    monkeypatch.setattr(
        "app.routes.jira_integration.resolve_org",
        lambda db, p: MagicMock(id=org_id),
    )
    monkeypatch.setattr(
        "app.routes.jira_integration._jira_provider",
        lambda db, oid: provider,
    )
    monkeypatch.setattr(
        "app.routes.jira_integration.provider_config",
        lambda prov: {
            "site_url": "https://acme.atlassian.net",
            "email": "ops@example.com",
            "api_token": "token",
            "project_key": "KAN",
        },
    )
    monkeypatch.setattr(
        "app.routes.jira_integration.JiraClient.list_projects",
        lambda self: [
            {"key": "KAN", "name": "Kanban", "id": "10000"},
            {"key": "SEC", "name": "Security", "id": "10001"},
        ],
    )

    out = list_jira_projects(
        _rbac=MagicMock(),
        p={"org_id": str(org_id)},
        db=mock_db,
    )

    assert [project.model_dump() for project in out] == [
        {"key": "KAN", "name": "Kanban", "id": "10000"},
        {"key": "SEC", "name": "Security", "id": "10001"},
    ]


def test_jira_search_assignable_users_maps_avatar_and_filters_incomplete_rows():
    captured = {}

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, path, *, params):
            captured["path"] = path
            captured["params"] = params
            return MagicMock(
                status_code=200,
                json=MagicMock(
                    return_value=[
                        {
                            "accountId": "abc123",
                            "displayName": "Ada Lovelace",
                            "emailAddress": "ada@example.com",
                            "avatarUrls": {"48x48": "https://avatar.example/ada.png"},
                        },
                        {"accountId": "", "displayName": "Missing id"},
                    ]
                ),
                raise_for_status=MagicMock(),
            )

    client = JiraClient(site_url="acme.atlassian.net", email="ops@example.com", api_token="token")
    with patch.object(client, "_client", return_value=FakeClient()):
        users = client.search_assignable_users(project_key="kan", query="ada")

    assert captured["path"] == "/user/assignable/search"
    assert captured["params"] == {"project": "KAN", "query": "ada", "maxResults": 15}
    assert users == [
        {
            "account_id": "abc123",
            "display_name": "Ada Lovelace",
            "email": "ada@example.com",
            "avatar_url": "https://avatar.example/ada.png",
        }
    ]


def test_jira_issue_description_includes_actionable_remediation_context():
    finding = MagicMock()
    finding.severity = "high"
    finding.risk_score = 85
    finding.check_id = "iam.role.least_privilege_policy"
    finding.resource_arn = "arn:aws:iam::123456789012:role/CCLabAdminRole"
    account = MagicMock(label="prod", account_id="123456789012")

    description = _issue_description(
        finding=finding,
        finding_url="https://app.example/findings?finding=1",
        account=account,
        actor="sec@example.com",
    )

    assert "Opened from Veritrail" in description
    assert "Opened by: sec@example.com" in description
    assert "Recommended remediation" in description
    assert "Replace broad IAM permissions with least-privilege policies" in description
    assert "Verification" in description


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
