from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from urllib.parse import quote

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.github import CiPipeline, IdentityProvider, IdentityUser, PullRequest, Repo, RepoProtection

GITLAB_COM = "https://gitlab.com"


@dataclass
class GitLabSyncStats:
    identity_users: int = 0
    repos: int = 0
    repo_protections: int = 0
    pull_requests: int = 0
    ci_pipelines: int = 0


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
        return None


def _api_base(config: dict[str, Any]) -> str:
    base = (config.get("base_url") or GITLAB_COM).rstrip("/")
    return f"{base}/api/v4"


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _paginate(client: httpx.Client, url: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page = 1
    while True:
        p = {"per_page": 100, "page": page, **(params or {})}
        resp = client.get(url, params=p)
        if resp.status_code in (403, 404):
            return rows
        resp.raise_for_status()
        data = resp.json()
        if not isinstance(data, list) or not data:
            break
        rows.extend(data)
        next_page = resp.headers.get("X-Next-Page", "")
        if not next_page:
            break
        page = int(next_page)
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
    row.name = member.get("name") or member.get("username")
    row.mfa_enabled = member.get("two_factor_enabled")
    row.status = "active" if member.get("state", "active") == "active" else "inactive"
    row.roles_json = {
        "username": member.get("username"),
        "access_level": member.get("access_level"),
        "is_admin": bool(member.get("is_admin")),
    }
    row.last_active_at = _parse_dt(member.get("last_activity_on") or member.get("last_sign_in_at"))
    row.snapshot_taken_at = now


def _upsert_repo(
    db: Session,
    provider_id: uuid.UUID,
    project: dict[str, Any],
    now: datetime,
    *,
    has_codeowners: bool | None = None,
    protected_envs: list | None = None,
) -> Repo:
    external_id = str(project["id"])
    row = db.scalar(select(Repo).where(Repo.provider_id == provider_id, Repo.external_id == external_id))
    if not row:
        row = Repo(id=uuid.uuid4(), provider_id=provider_id, external_id=external_id)
        db.add(row)
    row.name = project.get("path_with_namespace") or project.get("name", "")
    row.default_branch = project.get("default_branch")
    if has_codeowners is not None:
        row.has_codeowners = has_codeowners
    if protected_envs is not None:
        row.protected_envs = protected_envs
    row.snapshot_taken_at = now
    return row


def _check_codeowners(client: httpx.Client, api_base: str, project_id: int, ref: str | None) -> bool:
    """Return True if CODEOWNERS exists in a standard GitLab location."""
    if not ref:
        return False
    for path in ("CODEOWNERS", ".gitlab/CODEOWNERS", "docs/CODEOWNERS"):
        encoded = quote(path, safe="")
        resp = client.get(
            f"{api_base}/projects/{project_id}/repository/files/{encoded}",
            params={"ref": ref},
        )
        if resp.status_code == 200:
            return True
    return False


def _upsert_protection(
    db: Session,
    repo_id: uuid.UUID,
    branch: str,
    pb: dict[str, Any],
    required_reviews: int,
    now: datetime,
) -> None:
    row = db.get(RepoProtection, {"repo_id": repo_id, "branch": branch})
    if not row:
        row = RepoProtection(repo_id=repo_id, branch=branch)
        db.add(row)
    row.required_reviews = required_reviews
    row.dismiss_stale = False
    row.require_code_owners = bool(pb.get("code_owner_approval_required"))
    row.allow_force_push = bool(pb.get("allow_force_push"))
    row.required_status_checks = []
    row.snapshot_taken_at = now


def _upsert_mr(
    db: Session,
    repo_id: uuid.UUID,
    mr: dict[str, Any],
    required_reviews: int,
    approval_count: int,
    now: datetime,
) -> None:
    iid = mr["iid"]
    row = db.scalar(select(PullRequest).where(PullRequest.repo_id == repo_id, PullRequest.number == iid))
    if not row:
        row = PullRequest(id=uuid.uuid4(), repo_id=repo_id, number=iid)
        db.add(row)
    author_id = (mr.get("author") or {}).get("id")
    merged_by_id = (mr.get("merged_by") or {}).get("id")
    row.author = (mr.get("author") or {}).get("username")
    row.merged_at = _parse_dt(mr.get("merged_at"))
    row.merged_by = (mr.get("merged_by") or {}).get("username")
    row.required_review_count = required_reviews
    row.approval_count = approval_count
    row.self_merge = bool(author_id and merged_by_id and author_id == merged_by_id)
    row.snapshot_taken_at = now


def _upsert_ci_pipeline(
    db: Session,
    repo_id: uuid.UUID,
    pipeline: dict[str, Any],
    now: datetime,
) -> None:
    pid = pipeline["id"]
    row = db.scalar(select(CiPipeline).where(CiPipeline.repo_id == repo_id, CiPipeline.pipeline_id == pid))
    if not row:
        row = CiPipeline(id=uuid.uuid4(), repo_id=repo_id, pipeline_id=pid)
        db.add(row)
    row.ref = pipeline.get("ref")
    row.status = pipeline.get("status", "unknown")
    row.source = pipeline.get("source")
    row.actor = (pipeline.get("user") or {}).get("username")
    row.created_at = _parse_dt(pipeline.get("created_at"))
    row.finished_at = _parse_dt(pipeline.get("finished_at") or pipeline.get("updated_at"))
    row.duration = pipeline.get("duration")
    row.snapshot_taken_at = now


def _collect_protected_environments(
    client: httpx.Client,
    api_base: str,
    project_id: int,
) -> list[dict[str, Any]]:
    resp = client.get(f"{api_base}/projects/{project_id}/protected_environments")
    if resp.status_code != 200:
        return []
    envs: list[dict[str, Any]] = []
    for env in resp.json():
        name = env.get("name", "")
        if not name:
            continue
        required = int(env.get("required_approval_count") or 0)
        approval_rules = env.get("approval_rules") or []
        has_reviewers = required > 0 or bool(approval_rules)
        envs.append(
            {
                "name": name,
                "has_required_reviewers": has_reviewers,
                "reviewer_count": required or len(approval_rules),
            }
        )
    return envs


def _collect_ci_pipelines(
    client: httpx.Client,
    db: Session,
    repo_id: uuid.UUID,
    api_base: str,
    project_id: int,
    default_branch: str | None,
    now: datetime,
) -> int:
    params: dict[str, Any] = {"per_page": 50, "order_by": "id", "sort": "desc"}
    if default_branch:
        params["ref"] = default_branch

    resp = client.get(f"{api_base}/projects/{project_id}/pipelines", params=params)
    if resp.status_code in (403, 404):
        return 0
    if not resp.is_success:
        return 0

    pipelines = resp.json()
    for p in pipelines:
        _upsert_ci_pipeline(db, repo_id, p, now)
    return len(pipelines)


def sync_gitlab_provider(
    db: Session,
    provider: IdentityProvider,
    group_id: str | None = None,
) -> GitLabSyncStats:
    from app.services.gitlab_tokens import GitLabReconnectRequired, ensure_gitlab_token

    config = provider_config(provider)
    try:
        token = ensure_gitlab_token(db, provider)
    except GitLabReconnectRequired:
        raise

    api = _api_base(config)
    now = datetime.now(timezone.utc)
    stats = GitLabSyncStats()

    groups = [str(g).strip() for g in (config.get("group_ids") or []) if str(g).strip()]
    if group_id:
        groups = [group_id.strip()]
    if not groups:
        fallback = str(config.get("group_id") or config.get("namespace") or "").strip()
        groups = [fallback] if fallback else []
    groups = list(dict.fromkeys(groups))
    if not groups:
        raise ValueError("GitLab group or namespace is required")

    selected_repos = set(config.get("selected_repos") or [])

    with httpx.Client(headers=_headers(token), timeout=20) as client:
        user_resp = client.get(f"{api}/user")
        user_resp.raise_for_status()
        gl_user = user_resp.json()
        config["username"] = gl_user.get("username")

        for gid in groups:
            members = _paginate(client, f"{api}/groups/{gid}/members")
            if not members:
                members = [gl_user]
            for member in members:
                _upsert_identity_user(db, provider.id, member, now)
            stats.identity_users += len(members)

            projects = _paginate(
                client,
                f"{api}/groups/{gid}/projects",
                {"include_subgroups": "true", "archived": "false"},
            )
            if not projects:
                projects = _paginate(client, f"{api}/users/{gid}/projects")
            if selected_repos:
                projects = [p for p in projects if p.get("path_with_namespace") in selected_repos]

            for project in projects:
                project_id = project["id"]
                default_branch = project.get("default_branch")
                has_codeowners = _check_codeowners(client, api, project_id, default_branch)
                protected_envs = _collect_protected_environments(client, api, project_id)
                repo = _upsert_repo(
                    db,
                    provider.id,
                    project,
                    now,
                    has_codeowners=has_codeowners,
                    protected_envs=protected_envs or None,
                )
                db.flush()
                stats.repos += 1

                approvals_resp = client.get(f"{api}/projects/{project_id}/approvals")
                required_reviews = 0
                if approvals_resp.status_code == 200:
                    required_reviews = int(approvals_resp.json().get("approvals_before_merge") or 0)

                if default_branch:
                    protected = _paginate(client, f"{api}/projects/{project_id}/protected_branches")
                    for pb in protected:
                        if pb.get("name") == default_branch:
                            _upsert_protection(db, repo.id, default_branch, pb, required_reviews, now)
                            stats.repo_protections += 1
                            break

                mrs = _paginate(
                    client,
                    f"{api}/projects/{project_id}/merge_requests",
                    {"state": "merged", "order_by": "updated_at", "sort": "desc"},
                )[:100]
                for mr in mrs:
                    ap_resp = client.get(f"{api}/projects/{project_id}/merge_requests/{mr['iid']}/approvals")
                    approval_count = 0
                    if ap_resp.status_code == 200:
                        approval_count = len(ap_resp.json().get("approved_by") or [])
                    _upsert_mr(db, repo.id, mr, required_reviews, approval_count, now)
                    stats.pull_requests += 1

                # GitLab CI/CD pipelines (CC8.1 change management evidence)
                stats.ci_pipelines += _collect_ci_pipelines(
                    client, db, repo.id, api, project_id, default_branch, now
                )

    config["group_id"] = groups[0]
    config["group_ids"] = groups
    set_provider_config(provider, config)
    provider.status = "connected"
    provider.last_synced_at = now
    db.commit()
    return stats
