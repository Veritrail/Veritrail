"""Slack + Jira integration helpers and alert delivery."""
from __future__ import annotations

import uuid
import json
from unittest.mock import MagicMock, patch

import httpx
import pytest
from fastapi import HTTPException

from app.routes.jira_integration import (
    FINDINGS_BATCH_CAP,
    _combined_issue_summary,
    _issue_description,
    create_issue_from_finding,
    create_issues_from_findings,
    list_jira_project_issue_types,
    list_jira_projects,
    sync_jira_issue_from_finding,
)
from app.services.jira_client import JiraClient, dedupe_assignable_users, normalize_site_url
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
            description="Severity: HIGH\n\nRecommended remediation\nScope the policy",
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
    assert fields["description"]["content"][1]["content"][1]["type"] == "hardBreak"


def test_jira_create_issue_accepts_issue_type_id():
    captured = {}

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, path, *, content):
            captured["payload"] = json.loads(content)
            return MagicMock(
                status_code=201,
                json=MagicMock(return_value={"key": "KAN-2", "id": "10002"}),
                raise_for_status=MagicMock(),
            )

    client = JiraClient(site_url="acme.atlassian.net", email="ops@example.com", api_token="token")
    with patch.object(client, "_client", return_value=FakeClient()):
        issue = client.create_issue(
            project_key="KAN",
            summary="Bug report",
            description="Details",
            issue_type="10003",
        )

    assert issue["issue_key"] == "KAN-2"
    assert captured["payload"]["fields"]["issuetype"] == {"id": "10003"}


def test_jira_list_issue_types_marks_first_non_subtask_as_default():
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
                    return_value={
                        "projects": [
                            {
                                "issuetypes": [
                                    {
                                        "id": "10001",
                                        "name": "Task",
                                        "subtask": False,
                                        "iconUrl": "https://acme.atlassian.net/rest/api/2/universal_avatar/view/type/issuetype/avatar/10318",
                                    },
                                    {"id": "10002", "name": "Sub-task", "subtask": True},
                                    {
                                        "id": "10003",
                                        "name": "Bug",
                                        "subtask": False,
                                        "iconUrl": "https://acme.atlassian.net/rest/api/2/universal_avatar/view/type/issuetype/avatar/10303",
                                    },
                                ]
                            }
                        ]
                    }
                ),
                raise_for_status=MagicMock(),
            )

    client = JiraClient(site_url="acme.atlassian.net", email="ops@example.com", api_token="token")
    with patch.object(client, "_client", return_value=FakeClient()):
        issue_types = client.list_issue_types(project_key="kan")

    assert captured["path"] == "/issue/createmeta"
    assert captured["params"] == {"projectKeys": "KAN", "expand": "projects.issuetypes"}
    assert issue_types == [
        {
            "id": "10001",
            "name": "Task",
            "subtask": False,
            "is_default": True,
            "icon_url": "https://acme.atlassian.net/rest/api/2/universal_avatar/view/type/issuetype/avatar/10318",
        },
        {
            "id": "10003",
            "name": "Bug",
            "subtask": False,
            "is_default": False,
            "icon_url": "https://acme.atlassian.net/rest/api/2/universal_avatar/view/type/issuetype/avatar/10303",
        },
    ]


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


def test_list_jira_project_issue_types_route_returns_project_types(mock_db, monkeypatch):
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
        "app.routes.jira_integration.JiraClient.list_issue_types",
        lambda self, *, project_key: [
            {
                "id": "10001",
                "name": "Task",
                "subtask": False,
                "is_default": True,
                "icon_url": "https://acme.atlassian.net/rest/api/2/universal_avatar/view/type/issuetype/avatar/10318",
            },
            {
                "id": "10003",
                "name": "Bug",
                "subtask": False,
                "is_default": False,
                "icon_url": "https://acme.atlassian.net/rest/api/2/universal_avatar/view/type/issuetype/avatar/10303",
            },
        ],
    )

    out = list_jira_project_issue_types(
        project_key="kan",
        _rbac=MagicMock(),
        p={"org_id": str(org_id)},
        db=mock_db,
    )

    assert [issue_type.model_dump() for issue_type in out] == [
        {
            "id": "10001",
            "name": "Task",
            "subtask": False,
            "is_default": True,
            "icon_url": "https://acme.atlassian.net/rest/api/2/universal_avatar/view/type/issuetype/avatar/10318",
        },
        {
            "id": "10003",
            "name": "Bug",
            "subtask": False,
            "is_default": False,
            "icon_url": "https://acme.atlassian.net/rest/api/2/universal_avatar/view/type/issuetype/avatar/10303",
        },
    ]


def test_create_issue_from_finding_uses_request_issue_type(mock_db, monkeypatch):
    org_id = uuid.uuid4()
    finding_id = uuid.uuid4()
    user_id = uuid.uuid4()
    provider = MagicMock()
    provider.status = "connected"

    finding = MagicMock()
    finding.id = finding_id
    finding.org_id = org_id
    finding.evidence = {}
    finding.remediation_ticket_key = None
    finding.remediation_ticket_url = None
    finding.severity = "high"
    finding.risk_score = 80
    finding.check_id = "iam.role.least_privilege_policy"
    finding.resource_arn = "arn:aws:iam::123456789012:role/Example"
    finding.title = "Overprivileged role"
    finding.account_id = None

    mock_db.get.side_effect = lambda model, pk: finding if pk == finding_id else None

    captured: dict[str, str] = {}

    class FakeJiraClient:
        def __init__(self, **kwargs):
            pass

        def create_issue(self, **kwargs):
            captured.update(kwargs)
            return {
                "issue_key": "KAN-9",
                "issue_url": "https://acme.atlassian.net/browse/KAN-9",
                "issue_id": "10009",
            }

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
            "issue_type": "Task",
        },
    )
    monkeypatch.setattr("app.routes.jira_integration.JiraClient", FakeJiraClient)
    monkeypatch.setattr(
        "app.routes.jira_integration.resolve_user_display_name",
        lambda user: "Ops User",
    )
    monkeypatch.setattr(
        "app.routes.jira_integration._findings_app_url",
        lambda: "https://app.example",
    )

    out = create_issue_from_finding(
        finding_id=finding_id,
        _rbac=MagicMock(),
        body=MagicMock(
            summary="Custom summary",
            priority="High",
            assignee_account_id=None,
            labels=["veritrail", "high"],
            project_key="KAN",
            issue_type="10003",
        ),
        p={"sub": str(user_id), "org_id": str(org_id)},
        db=mock_db,
    )

    assert out.issue_key == "KAN-9"
    assert captured["issue_type"] == "10003"
    assert captured["project_key"] == "KAN"
    mock_db.commit.assert_called_once()


def test_dedupe_assignable_users_collapses_duplicate_account_ids():
    users = [
        {
            "account_id": "abc123",
            "display_name": "Ada Lovelace",
            "email": "",
            "avatar_url": "",
        },
        {
            "account_id": "abc123",
            "display_name": "Ada Lovelace",
            "email": "ada@example.com",
            "avatar_url": "https://avatar.example/ada.png",
        },
    ]
    assert dedupe_assignable_users(users) == [users[1]]


def test_dedupe_assignable_users_keeps_same_display_name_different_accounts():
    users = [
        {
            "account_id": "ghost-account",
            "display_name": "Elazar Chodjayev",
            "email": "",
            "avatar_url": "https://avatar.example/ghost.png",
        },
        {
            "account_id": "real-account",
            "display_name": "Elazar Chodjayev",
            "email": "zenmyx@gmail.com",
            "avatar_url": "https://avatar.example/real.png",
        },
    ]
    assert dedupe_assignable_users(users) == users


def test_dedupe_assignable_users_keeps_distinct_people_with_same_name_and_email():
    users = [
        {
            "account_id": "one",
            "display_name": "Alex Smith",
            "email": "alex.a@example.com",
            "avatar_url": "",
        },
        {
            "account_id": "two",
            "display_name": "Alex Smith",
            "email": "alex.b@example.com",
            "avatar_url": "",
        },
    ]
    assert dedupe_assignable_users(users) == users


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
                            "displayName": "Elazar Chodjayev",
                            "emailAddress": "zenmyx@gmail.com",
                            "avatarUrls": {"48x48": "https://avatar.example/zenmyx.png"},
                        },
                        {
                            "accountId": "def456",
                            "displayName": "Elazar Chodjayev",
                            "emailAddress": "other@example.com",
                            "avatarUrls": {"48x48": "https://avatar.example/other.png"},
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
            "display_name": "Elazar Chodjayev",
            "email": "zenmyx@gmail.com",
            "avatar_url": "https://avatar.example/zenmyx.png",
        },
        {
            "account_id": "def456",
            "display_name": "Elazar Chodjayev",
            "email": "other@example.com",
            "avatar_url": "https://avatar.example/other.png",
        },
    ]


def test_jira_get_issue_status_maps_done_category():
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
                    return_value={
                        "fields": {
                            "status": {
                                "name": "Done",
                                "statusCategory": {"key": "done", "name": "Done"},
                            }
                        }
                    }
                ),
                raise_for_status=MagicMock(),
            )

    client = JiraClient(site_url="acme.atlassian.net", email="ops@example.com", api_token="token")
    with patch.object(client, "_client", return_value=FakeClient()):
        status = client.get_issue_status("kan-42")

    assert captured["path"] == "/issue/KAN-42"
    assert captured["params"] == {"fields": "status"}
    assert status == {"issue_key": "KAN-42", "status": "Done", "status_category": "done"}


def test_sync_jira_issue_from_finding_persists_status(mock_db, monkeypatch):
    org_id = uuid.uuid4()
    finding_id = uuid.uuid4()
    provider = MagicMock()
    provider.status = "connected"

    finding = MagicMock()
    finding.id = finding_id
    finding.org_id = org_id
    finding.evidence = {
        "jira": {
            "issue_key": "KAN-9",
            "issue_url": "https://acme.atlassian.net/browse/KAN-9",
        }
    }
    finding.remediation_ticket_key = "KAN-9"
    finding.remediation_ticket_url = "https://acme.atlassian.net/browse/KAN-9"

    mock_db.get.return_value = finding

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
        "app.routes.jira_integration.JiraClient.get_issue_status",
        lambda self, issue_key: {
            "issue_key": issue_key,
            "status": "Done",
            "status_category": "done",
        },
    )

    out = sync_jira_issue_from_finding(
        finding_id=finding_id,
        p={"org_id": str(org_id)},
        db=mock_db,
    )

    assert out.issue_key == "KAN-9"
    assert out.status == "Done"
    assert out.status_category == "done"
    assert out.is_done is True
    assert finding.evidence["jira"]["status"] == "Done"
    assert finding.evidence["jira"]["status_category"] == "done"
    assert finding.evidence["jira"]["status_synced_at"]
    mock_db.commit.assert_called_once()


def test_sync_jira_issue_from_finding_aborts_when_ticket_unlinked(mock_db, monkeypatch):
    org_id = uuid.uuid4()
    finding_id = uuid.uuid4()
    provider = MagicMock()
    provider.status = "connected"

    finding = MagicMock()
    finding.id = finding_id
    finding.org_id = org_id
    finding.evidence = {
        "jira": {
            "issue_key": "KAN-9",
            "issue_url": "https://acme.atlassian.net/browse/KAN-9",
        }
    }
    finding.remediation_ticket_key = "KAN-9"
    finding.remediation_ticket_url = "https://acme.atlassian.net/browse/KAN-9"

    def refresh_side_effect(obj):
        obj.evidence = {}
        obj.remediation_ticket_key = None
        obj.remediation_ticket_url = None

    mock_db.get.return_value = finding
    mock_db.refresh.side_effect = refresh_side_effect

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
        "app.routes.jira_integration.JiraClient.get_issue_status",
        lambda self, issue_key: {
            "issue_key": issue_key,
            "status": "In Review",
            "status_category": "indeterminate",
        },
    )

    with pytest.raises(HTTPException) as exc:
        sync_jira_issue_from_finding(
            finding_id=finding_id,
            p={"org_id": str(org_id)},
            db=mock_db,
        )

    assert exc.value.status_code == 404
    mock_db.commit.assert_not_called()


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
        actor="Eliazar Chodjayev",
    )

    assert description.startswith("Opened by: Eliazar Chodjayev\n")
    assert "Opened by: Eliazar Chodjayev\nOpened at:" in description
    assert "Account: prod (123456789012)\n\nSeverity: HIGH · Risk score 85\n" in description
    assert (
        "Severity: HIGH · Risk score 85\n"
        "Check: iam.role.least_privilege_policy\n"
        "Resource: arn:aws:iam::123456789012:role/CCLabAdminRole\n\n"
        "Recommended remediation\n"
    ) in description
    assert "Severity: HIGH · Risk score: 85\n\nCheck:" not in description
    assert "Scope this IAM role to the permissions observed in use" in description
    assert (
        "explicitly required and approved.\n\n"
        "Verification\n"
        "After remediation, return to Veritrail and run Verify fix"
    ) in description
    assert description.endswith("https://app.example/findings?finding=1")


def _jira_route_patches(monkeypatch, *, org_id, provider):
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
            "issue_type": "Task",
        },
    )
    monkeypatch.setattr(
        "app.routes.jira_integration.resolve_user_display_name",
        lambda user: "Ops User",
    )
    monkeypatch.setattr(
        "app.routes.jira_integration._findings_app_url",
        lambda: "https://app.example",
    )


def _finding_mock(*, finding_id, org_id, resource_arn, linked=False):
    finding = MagicMock()
    finding.id = finding_id
    finding.org_id = org_id
    finding.evidence = (
        {"jira": {"issue_key": "KAN-1", "issue_url": "https://acme.atlassian.net/browse/KAN-1"}}
        if linked
        else {}
    )
    finding.remediation_ticket_key = "KAN-1" if linked else None
    finding.remediation_ticket_url = (
        "https://acme.atlassian.net/browse/KAN-1" if linked else None
    )
    finding.severity = "high"
    finding.risk_score = 80
    finding.check_id = "iam.role.least_privilege_policy"
    finding.resource_arn = resource_arn
    finding.title = "Overprivileged role"
    finding.account_id = None
    return finding


def test_create_issues_from_findings_creates_one_issue_and_links_all(mock_db, monkeypatch):
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    finding_ids = [uuid.uuid4(), uuid.uuid4()]
    provider = MagicMock()
    provider.status = "connected"

    findings = {
        finding_ids[0]: _finding_mock(
            finding_id=finding_ids[0],
            org_id=org_id,
            resource_arn="arn:aws:iam::123456789012:role/A",
        ),
        finding_ids[1]: _finding_mock(
            finding_id=finding_ids[1],
            org_id=org_id,
            resource_arn="arn:aws:iam::123456789012:role/B",
        ),
    }

    def get_side_effect(model, pk):
        if pk == user_id:
            return MagicMock()
        return findings.get(pk)

    mock_db.get.side_effect = get_side_effect
    captured: dict = {}

    class FakeJiraClient:
        def __init__(self, **kwargs):
            pass

        def create_issue(self, **kwargs):
            captured.update(kwargs)
            return {
                "issue_key": "KAN-42",
                "issue_url": "https://acme.atlassian.net/browse/KAN-42",
                "issue_id": "10042",
            }

    monkeypatch.setattr("app.routes.jira_integration.JiraClient", FakeJiraClient)
    _jira_route_patches(monkeypatch, org_id=org_id, provider=provider)

    out = create_issues_from_findings(
        _rbac=MagicMock(),
        body=MagicMock(
            finding_ids=finding_ids,
            project_key="KAN",
            issue_type="10003",
            assignee_account_id=None,
            summary=None,
            priority=None,
            labels=["veritrail", "high"],
        ),
        p={"sub": str(user_id), "org_id": str(org_id)},
        db=mock_db,
    )

    assert out.issue_key == "KAN-42"
    assert out.linked_count == 2
    assert out.skipped_already_linked == []
    assert "role/A" in captured["description"]
    assert "role/B" in captured["description"]
    assert "[ ]" in captured["description"]
    for finding in findings.values():
        assert finding.remediation_ticket_key == "KAN-42"
        assert finding.remediation_ticket_url == "https://acme.atlassian.net/browse/KAN-42"
    event_notes = [
        call.args[0].note
        for call in mock_db.add.call_args_list
        if hasattr(call.args[0], "note")
    ]
    assert event_notes.count("Jira issue created: KAN-42") == 2
    mock_db.commit.assert_called_once()


def test_create_issues_from_findings_rejects_other_org(mock_db, monkeypatch):
    org_id = uuid.uuid4()
    other_org_id = uuid.uuid4()
    finding_id = uuid.uuid4()
    provider = MagicMock()
    provider.status = "connected"
    finding = _finding_mock(
        finding_id=finding_id,
        org_id=other_org_id,
        resource_arn="arn:aws:iam::123456789012:role/A",
    )
    mock_db.get.side_effect = lambda model, pk: finding if pk == finding_id else None
    _jira_route_patches(monkeypatch, org_id=org_id, provider=provider)

    with pytest.raises(HTTPException) as exc:
        create_issues_from_findings(
            _rbac=MagicMock(),
            body=MagicMock(
                finding_ids=[finding_id],
                project_key="KAN",
                issue_type="Task",
                assignee_account_id=None,
                summary=None,
                priority=None,
                labels=None,
            ),
            p={"sub": str(uuid.uuid4()), "org_id": str(org_id)},
            db=mock_db,
        )

    assert exc.value.status_code == 404


def test_create_issues_from_findings_rejects_empty_and_over_cap(mock_db, monkeypatch):
    org_id = uuid.uuid4()
    provider = MagicMock()
    provider.status = "connected"
    _jira_route_patches(monkeypatch, org_id=org_id, provider=provider)

    with pytest.raises(HTTPException) as exc:
        create_issues_from_findings(
            _rbac=MagicMock(),
            body=MagicMock(
                finding_ids=[],
                project_key="KAN",
                issue_type="Task",
                assignee_account_id=None,
                summary=None,
                priority=None,
                labels=None,
            ),
            p={"sub": str(uuid.uuid4()), "org_id": str(org_id)},
            db=mock_db,
        )
    assert exc.value.status_code == 400

    over_cap = [uuid.uuid4() for _ in range(FINDINGS_BATCH_CAP + 1)]
    with pytest.raises(HTTPException) as exc:
        create_issues_from_findings(
            _rbac=MagicMock(),
            body=MagicMock(
                finding_ids=over_cap,
                project_key="KAN",
                issue_type="Task",
                assignee_account_id=None,
                summary=None,
                priority=None,
                labels=None,
            ),
            p={"sub": str(uuid.uuid4()), "org_id": str(org_id)},
            db=mock_db,
        )
    assert exc.value.status_code == 400
    assert str(FINDINGS_BATCH_CAP) in str(exc.value.detail)


def test_create_issues_from_findings_skips_already_linked(mock_db, monkeypatch):
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    linked_id = uuid.uuid4()
    fresh_id = uuid.uuid4()
    provider = MagicMock()
    provider.status = "connected"

    findings = {
        linked_id: _finding_mock(
            finding_id=linked_id,
            org_id=org_id,
            resource_arn="arn:aws:iam::123456789012:role/Linked",
            linked=True,
        ),
        fresh_id: _finding_mock(
            finding_id=fresh_id,
            org_id=org_id,
            resource_arn="arn:aws:iam::123456789012:role/Fresh",
        ),
    }

    def get_side_effect(model, pk):
        if pk == user_id:
            return MagicMock()
        return findings.get(pk)

    mock_db.get.side_effect = get_side_effect

    class FakeJiraClient:
        def __init__(self, **kwargs):
            pass

        def create_issue(self, **kwargs):
            return {
                "issue_key": "KAN-99",
                "issue_url": "https://acme.atlassian.net/browse/KAN-99",
                "issue_id": "10099",
            }

    monkeypatch.setattr("app.routes.jira_integration.JiraClient", FakeJiraClient)
    _jira_route_patches(monkeypatch, org_id=org_id, provider=provider)

    out = create_issues_from_findings(
        _rbac=MagicMock(),
        body=MagicMock(
            finding_ids=[linked_id, fresh_id],
            project_key="KAN",
            issue_type="Task",
            assignee_account_id=None,
            summary=None,
            priority=None,
            labels=None,
        ),
        p={"sub": str(user_id), "org_id": str(org_id)},
        db=mock_db,
    )

    assert out.linked_count == 1
    assert out.skipped_already_linked == [str(linked_id)]
    assert findings[fresh_id].remediation_ticket_key == "KAN-99"
    assert findings[linked_id].remediation_ticket_key == "KAN-1"


def test_combined_issue_summary_uses_resource_count():
    findings = [
        _finding_mock(
            finding_id=uuid.uuid4(),
            org_id=uuid.uuid4(),
            resource_arn="arn:aws:iam::123456789012:role/A",
        ),
        _finding_mock(
            finding_id=uuid.uuid4(),
            org_id=uuid.uuid4(),
            resource_arn="arn:aws:iam::123456789012:role/B",
        ),
    ]
    assert _combined_issue_summary(findings).endswith("— 2 resources")


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
