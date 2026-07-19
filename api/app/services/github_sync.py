from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.github import IdentityProvider, IdentityUser, PullRequest, Repo, RepoProtection, WorkflowRun


GITHUB_API = "https://api.github.com"


@dataclass
class GitHubSyncStats:
    identity_users: int = 0
    repos: int = 0
    repo_protections: int = 0
    pull_requests: int = 0
    workflow_runs: int = 0
    security_alerts: int = 0


def provider_config(provider: IdentityProvider) -> dict[str, Any]:
    try:
        return json.loads(provider.config_json_encrypted or "{}")
    except json.JSONDecodeError:
        return {}


def set_provider_config(provider: IdentityProvider, config: dict[str, Any]) -> None:
    provider.config_json_encrypted = json.dumps(config, separators=(",", ":"))


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        try:
            return parsedate_to_datetime(value)
        except Exception:
            return None


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _paginate(client: httpx.Client, path: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    url = f"{GITHUB_API}{path}"
    next_params = {"per_page": 100, **(params or {})}
    while url:
        resp = client.get(url, params=next_params)
        if resp.status_code == 404:
            return rows
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            rows.extend(data)
        else:
            return rows
        url = resp.links.get("next", {}).get("url")
        next_params = None
    return rows


def _upsert_identity_user(db: Session, provider_id: uuid.UUID, member: dict[str, Any], now: datetime) -> None:
    external_id = str(member["id"])
    row = db.scalar(
        select(IdentityUser).where(
            IdentityUser.provider_id == provider_id,
            IdentityUser.external_id == external_id,
        )
    )
    if not row:
        row = IdentityUser(id=uuid.uuid4(), provider_id=provider_id, external_id=external_id)
        db.add(row)
    row.email = member.get("email")
    row.name = member.get("name") or member.get("login")
    row.mfa_enabled = member.get("two_factor_authentication")
    row.status = "active"
    row.roles_json = {
        "login": member.get("login"),
        "site_admin": bool(member.get("site_admin")),
        "type": member.get("type"),
        "org_role": member.get("org_role"),
    }
    row.last_active_at = _parse_dt(member.get("last_activity_at") or member.get("updated_at"))
    row.snapshot_taken_at = now


def _upsert_repo(
    db: Session,
    provider_id: uuid.UUID,
    gh_repo: dict[str, Any],
    now: datetime,
    has_codeowners: bool | None = None,
    protected_envs: list | None = None,
    security_features: dict | None = None,
) -> "Repo":
    external_id = str(gh_repo["id"])
    row = db.scalar(select(Repo).where(Repo.provider_id == provider_id, Repo.external_id == external_id))
    if not row:
        row = Repo(id=uuid.uuid4(), provider_id=provider_id, external_id=external_id)
        db.add(row)
    row.name = gh_repo["full_name"]
    row.default_branch = gh_repo.get("default_branch")
    if has_codeowners is not None:
        row.has_codeowners = has_codeowners
    if protected_envs is not None:
        row.protected_envs = protected_envs
    if security_features is not None:
        row.security_features = security_features
    row.snapshot_taken_at = now
    return row


def _check_codeowners(client: httpx.Client, owner: str, repo_name: str) -> bool:
    """Return True if CODEOWNERS file exists in any standard location."""
    for path in ("CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"):
        resp = client.get(f"{GITHUB_API}/repos/{owner}/{repo_name}/contents/{path}")
        if resp.status_code == 200:
            return True
    return False


def _collect_team_memberships(client: httpx.Client, owner: str) -> dict[str, list[str]]:
    """Return {login: [team_slug, ...]} for all teams in the org."""
    login_to_teams: dict[str, list[str]] = {}
    teams = _paginate(client, f"/orgs/{owner}/teams")
    for team in teams:
        slug = team.get("slug", "")
        if not slug:
            continue
        members = _paginate(client, f"/orgs/{owner}/teams/{slug}/members")
        for m in members:
            login = m.get("login", "")
            if login:
                login_to_teams.setdefault(login, []).append(slug)
    return login_to_teams


def _collect_security_features(
    client: httpx.Client, owner: str, repo_name: str
) -> tuple[dict[str, Any], list, set[str]]:
    """Dependabot / CodeQL / secret-scanning enablement + alert activity (Phase 1).

    Third return value is the set of alert check IDs with an authoritative inventory
    for this repo (safe to include in persist ``check_ids_run`` only after intersecting
    across all repos in the sync).
    """
    from app.services.github_security_evidence import collect_github_security_evidence

    return collect_github_security_evidence(client, owner, repo_name)


def _collect_environments(client: httpx.Client, owner: str, repo_name: str) -> list[dict[str, Any]]:
    """Collect deployment environments with their protection rules."""
    resp = client.get(f"{GITHUB_API}/repos/{owner}/{repo_name}/environments")
    if resp.status_code != 200:
        return []
    envs = []
    for env in (resp.json().get("environments") or []):
        env_name = env.get("name", "")
        protection_rules = env.get("protection_rules") or []
        required_reviewers = [
            r for r in protection_rules if r.get("type") == "required_reviewers"
        ]
        envs.append({
            "name": env_name,
            "has_required_reviewers": bool(required_reviewers),
            "reviewer_count": sum(
                len(r.get("reviewers") or []) for r in required_reviewers
            ),
        })
    return envs


def _upsert_protection(db: Session, repo_id: uuid.UUID, branch: str, protection: dict[str, Any], now: datetime) -> None:
    row = db.get(RepoProtection, {"repo_id": repo_id, "branch": branch})
    if not row:
        row = RepoProtection(repo_id=repo_id, branch=branch)
        db.add(row)

    reviews = protection.get("required_pull_request_reviews") or {}
    status_checks = protection.get("required_status_checks") or {}
    restrictions = protection.get("restrictions")
    allow_force_pushes = protection.get("allow_force_pushes") or {}

    row.required_reviews = int(reviews.get("required_approving_review_count") or 0)
    row.dismiss_stale = bool(reviews.get("dismiss_stale_reviews"))
    row.require_code_owners = bool(reviews.get("require_code_owner_reviews"))
    row.allow_force_push = bool(allow_force_pushes.get("enabled")) if allow_force_pushes else False
    row.required_status_checks = status_checks.get("contexts") or []
    row.snapshot_taken_at = now
    if restrictions and isinstance(row.required_status_checks, list):
        row.required_status_checks = [
            *row.required_status_checks,
            {"restrictions": True},
        ]


def _upsert_pr(
    db: Session,
    repo_id: uuid.UUID,
    pr: dict[str, Any],
    required_review_count: int,
    approval_count: int,
    now: datetime,
) -> None:
    row = db.scalar(select(PullRequest).where(PullRequest.repo_id == repo_id, PullRequest.number == pr["number"]))
    if not row:
        row = PullRequest(id=uuid.uuid4(), repo_id=repo_id, number=pr["number"])
        db.add(row)
    author = (pr.get("user") or {}).get("login")
    merged_by = (pr.get("merged_by") or {}).get("login")
    row.author = author
    row.merged_at = _parse_dt(pr.get("merged_at"))
    row.merged_by = merged_by
    row.required_review_count = required_review_count
    row.approval_count = approval_count
    row.self_merge = bool(author and merged_by and author == merged_by)
    row.snapshot_taken_at = now


def _upsert_workflow_run(
    db: Session,
    repo_id: uuid.UUID,
    run: dict[str, Any],
    now: datetime,
) -> None:
    run_id = run["id"]
    row = db.scalar(select(WorkflowRun).where(WorkflowRun.repo_id == repo_id, WorkflowRun.run_id == run_id))
    if not row:
        row = WorkflowRun(id=uuid.uuid4(), repo_id=repo_id, run_id=run_id)
        db.add(row)
    row.name = run.get("name") or run.get("display_title") or "unknown"
    row.workflow_path = run.get("path") or run.get("workflow_id")
    row.event = run.get("event", "unknown")
    row.status = run.get("status", "unknown")
    row.conclusion = run.get("conclusion")
    row.branch = run.get("head_branch")
    row.actor = (run.get("actor") or {}).get("login") or (run.get("triggering_actor") or {}).get("login")
    # environment: check deployment via run's jobs if present; fallback None
    row.environment = run.get("_environment")
    row.run_started_at = _parse_dt(run.get("run_started_at") or run.get("created_at"))
    row.run_completed_at = _parse_dt(run.get("updated_at")) if run.get("status") == "completed" else None
    row.snapshot_taken_at = now


def _collect_workflow_runs(
    client: httpx.Client,
    db: Session,
    repo_id: uuid.UUID,
    owner: str,
    repo_name: str,
    default_branch: str | None,
    now: datetime,
) -> int:
    """Collect last 50 workflow runs on the default branch + any deployment runs."""
    collected = 0
    params: dict[str, Any] = {"per_page": 50}
    if default_branch:
        params["branch"] = default_branch

    resp = client.get(f"{GITHUB_API}/repos/{owner}/{repo_name}/actions/runs", params=params)
    if resp.status_code in (403, 404):
        return 0
    if not resp.is_success:
        return 0

    runs = resp.json().get("workflow_runs", [])

    # Also fetch deployment-event runs (no branch filter — deploy can be on any ref)
    deploy_resp = client.get(
        f"{GITHUB_API}/repos/{owner}/{repo_name}/actions/runs",
        params={"event": "deployment", "per_page": 20},
    )
    if deploy_resp.is_success:
        deploy_runs = deploy_resp.json().get("workflow_runs", [])
        seen_ids = {r["id"] for r in runs}
        for r in deploy_runs:
            if r["id"] not in seen_ids:
                runs.append(r)

    # Collect deployment environment info for runs with deployment event
    deployments_resp = client.get(
        f"{GITHUB_API}/repos/{owner}/{repo_name}/deployments",
        params={"per_page": 50},
    )
    deploy_env_by_sha: dict[str, str] = {}
    if deployments_resp.is_success:
        for d in deployments_resp.json():
            sha = d.get("sha", "")
            env = d.get("environment", "")
            if sha and env and sha not in deploy_env_by_sha:
                deploy_env_by_sha[sha] = env

    for run in runs:
        if deploy_env_by_sha:
            sha = run.get("head_sha", "")
            if sha in deploy_env_by_sha:
                run["_environment"] = deploy_env_by_sha[sha]
        _upsert_workflow_run(db, repo_id, run, now)
        collected += 1

    return collected


def sync_github_provider(db: Session, provider: IdentityProvider, org_login: str | None = None) -> GitHubSyncStats:
    """Sync the configured GitHub evidence scope."""
    config = provider_config(provider)
    token = config.get("access_token")
    if not token:
        raise ValueError("GitHub provider is missing an access token")

    now = datetime.now(timezone.utc)
    owners = [org_login.strip()] if org_login and org_login.strip() else [str(owner).strip() for owner in config.get("org_logins") or [] if str(owner).strip()]
    if not owners:
        fallback_owner = (config.get("org_login") or config.get("login") or "").strip()
        owners = [fallback_owner] if fallback_owner else []
    owners = list(dict.fromkeys(owners))
    if not owners:
        raise ValueError("GitHub owner/org login is required")
    selected_repos = set(config.get("selected_repos") or [])

    stats = GitHubSyncStats()
    alert_drafts: list = []
    # Alert checks are only auto-resolved when every synced repo produced an
    # authoritative inventory for that check. Permission denied / unavailable
    # must never resolve findings by absence (persist.py resolves missing keys
    # for anything in check_ids_run).
    alert_checks_collected: set[str] | None = None
    with httpx.Client(headers=_headers(token), timeout=20) as client:
        viewer = client.get(f"{GITHUB_API}/user")
        viewer.raise_for_status()
        config["login"] = viewer.json().get("login")

        outside_collaborators: list[dict[str, Any]] = []
        for owner in owners:
            # Org members expose 2FA state only when the OAuth token has suitable org access.
            members = _paginate(client, f"/orgs/{owner}/members")
            if not members:
                user_resp = client.get(f"{GITHUB_API}/users/{owner}")
                user_resp.raise_for_status()
                members = [user_resp.json()]
            for member in members:
                login = member.get("login", "")
                if login:
                    membership_resp = client.get(f"{GITHUB_API}/orgs/{owner}/memberships/{login}")
                    if membership_resp.status_code == 200:
                        member = {**member, "org_role": membership_resp.json().get("role")}
                _upsert_identity_user(db, provider.id, member, now)
            stats.identity_users += len(members)

            # Team memberships — update roles_json["teams"] for each member
            team_memberships = _collect_team_memberships(client, owner)
            for member in members:
                login = member.get("login", "")
                if login and login in team_memberships:
                    row = db.scalar(
                        select(IdentityUser).where(
                            IdentityUser.provider_id == provider.id,
                            IdentityUser.external_id == str(member["id"]),
                        )
                    )
                    if row:
                        row.roles_json = {**(row.roles_json or {}), "teams": team_memberships[login]}

            # Outside collaborators (non-org members with direct repo access)
            collabs = _paginate(client, f"/orgs/{owner}/outside_collaborators")
            outside_collaborators.extend(
                {"login": c.get("login"), "id": c.get("id")} for c in collabs
            )

            org_repos = _paginate(client, f"/orgs/{owner}/repos", {"type": "all", "sort": "updated"})
            repos = org_repos or _paginate(client, "/user/repos", {"affiliation": "owner,collaborator,organization_member", "sort": "updated"})
            repos = [r for r in repos if r.get("full_name", "").split("/")[0].lower() == owner.lower()]
            if selected_repos:
                repos = [r for r in repos if r.get("full_name") in selected_repos]
            for gh_repo in repos:
                owner_name, repo_name = gh_repo["full_name"].split("/", 1)
                has_codeowners = _check_codeowners(client, owner_name, repo_name)
                protected_envs = _collect_environments(client, owner_name, repo_name)
                security_features, repo_alert_drafts, repo_collected = _collect_security_features(
                    client, owner_name, repo_name
                )
                alert_drafts.extend(repo_alert_drafts)
                if alert_checks_collected is None:
                    alert_checks_collected = set(repo_collected)
                else:
                    alert_checks_collected &= repo_collected
                repo = _upsert_repo(
                    db,
                    provider.id,
                    gh_repo,
                    now,
                    has_codeowners=has_codeowners,
                    protected_envs=protected_envs,
                    security_features=security_features,
                )
                db.flush()
                stats.repos += 1

                branch = gh_repo.get("default_branch")
                if not branch:
                    continue
                protection_resp = client.get(f"{GITHUB_API}/repos/{owner_name}/{repo_name}/branches/{branch}/protection")
                required_reviews = 0
                if protection_resp.status_code == 200:
                    protection = protection_resp.json()
                    reviews = protection.get("required_pull_request_reviews") or {}
                    required_reviews = int(reviews.get("required_approving_review_count") or 0)
                    _upsert_protection(db, repo.id, branch, protection, now)
                    stats.repo_protections += 1

                pulls = _paginate(
                    client,
                    f"/repos/{owner_name}/{repo_name}/pulls",
                    {"state": "closed", "sort": "updated", "direction": "desc"},
                )[:100]
                for pr in pulls:
                    if not pr.get("merged_at"):
                        continue
                    reviews = _paginate(client, f"/repos/{owner_name}/{repo_name}/pulls/{pr['number']}/reviews")
                    approvers = {
                        (r.get("user") or {}).get("login")
                        for r in reviews
                        if r.get("state") == "APPROVED" and (r.get("user") or {}).get("login")
                    }
                    _upsert_pr(db, repo.id, pr, required_reviews, len(approvers), now)
                    stats.pull_requests += 1

                # GitHub Actions workflow runs (CC8.1 change management evidence)
                stats.workflow_runs += _collect_workflow_runs(
                    client, db, repo.id, owner_name, repo_name, branch, now
                )

    config["outside_collaborators"] = outside_collaborators
    config["org_login"] = owners[0]
    config["org_logins"] = owners
    set_provider_config(provider, config)
    provider.status = "connected"
    provider.last_synced_at = now
    db.flush()

    # Persist provider-native security alerts as org-scoped findings.
    # Only mark checks executed when collection succeeded on every repo;
    # drafts still upsert even when check_ids_run is empty/partial.
    from app.checks.persist import persist_org_findings

    check_ids_run = alert_checks_collected if alert_checks_collected is not None else set()
    opened, resolved = persist_org_findings(
        db,
        org_id=provider.org_id,
        drafts=alert_drafts,
        check_ids_run=check_ids_run,
    )
    stats.security_alerts = len(alert_drafts)
    # persist_org_findings commits; continue with source-control grading.
    _ = (opened, resolved)

    # Source control is org-level — grade Secure SDLC (and the source-control
    # part of Change Management) straight off this sync, not a cloud scan.
    from app.services.source_control_scan import run_source_control_checks

    run_source_control_checks(db, provider.org_id, "github")
    db.commit()
    return stats
