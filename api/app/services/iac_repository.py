"""IaC repository linking for Terraform/Terragrunt remediation workflows.

Config shape (stored on ``identity_providers`` type ``iac_repository``):

- ``uses_terragrunt``: whether the team uses Terragrunt live stacks
- ``repo_mode``: ``single`` (one repo, optional different subdirs) or ``dual`` (separate repos)
- ``terraform_repo``: modules / root Terraform (``vcs_provider``, ``repo_ref``, ``path``, optional token)
- ``terragrunt_repo``: live stacks when ``repo_mode`` is ``dual``

Single-repo Terragrunt layouts often use different subdirectories in the same repo:
- ``terraform_path`` — reusable modules (``.tf`` under ``modules/``)
- ``terragrunt_path`` — live stacks (``terragrunt.hcl`` under ``environments/*``)

Legacy ``github_issues`` rows (owner + repo only) migrate to single-repo GitHub config with
``terraform_path`` defaulting to ``.``.
"""
from __future__ import annotations

import base64
import re
import uuid
from typing import Any, Literal
from urllib.parse import quote, urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.github import IdentityProvider
from app.services.github_sync import provider_config, set_provider_config
from app.services.integration_input import (
    api_access_error,
    normalize_azure_devops_org_url,
    normalize_azure_devops_project,
)

IAC_REPOSITORY_TYPE = "iac_repository"
LEGACY_GITHUB_ISSUES_TYPE = "github_issues"
GITHUB_OAUTH_TYPE = "github"
GITLAB_OAUTH_TYPE = "gitlab"

VcsProvider = Literal["github", "gitlab", "azure_devops", "codecommit"]
RepoMode = Literal["single", "dual"]
SUPPORTED_VCS_PROVIDERS: tuple[VcsProvider, ...] = (
    "github",
    "gitlab",
    "azure_devops",
    "codecommit",
)
DEFAULT_TERRAFORM_PATH = "."


def normalize_repo_path(value: str | None, *, default: str = DEFAULT_TERRAFORM_PATH) -> str:
    raw = (value or "").strip().replace("\\", "/")
    if not raw or raw == "/":
        return default
    return raw.strip("/") or default


def _blank_repo_link(vcs_provider: VcsProvider = "github") -> dict[str, Any]:
    return {
        "vcs_provider": vcs_provider,
        "auth_method": "",
        "installation_id": "",
        "installation_account": "",
        "repository_id": "",
        "owner": "",
        "repo": "",
        "repo_ref": "",
        "path": DEFAULT_TERRAFORM_PATH,
        "access_token": "",
        "base_url": "",
    }


def _normalize_repo_link(raw: dict[str, Any] | None, *, default_provider: VcsProvider) -> dict[str, Any]:
    link = dict(_blank_repo_link(default_provider))
    if not raw:
        return link
    vcs = (raw.get("vcs_provider") or default_provider).strip().lower()
    if vcs not in SUPPORTED_VCS_PROVIDERS:
        vcs = default_provider
    link["vcs_provider"] = vcs
    owner = (raw.get("owner") or "").strip()
    repo = (raw.get("repo") or "").strip()
    repo_ref = (raw.get("repo_ref") or "").strip()
    if not repo_ref and owner and repo:
        repo_ref = f"{owner}/{repo}"
    link["owner"] = owner
    link["repo"] = repo
    link["repo_ref"] = repo_ref
    link["auth_method"] = (raw.get("auth_method") or "").strip()
    link["installation_id"] = str(raw.get("installation_id") or "").strip()
    link["installation_account"] = (raw.get("installation_account") or "").strip()
    link["repository_id"] = str(raw.get("repository_id") or "").strip()
    link["path"] = normalize_repo_path(raw.get("path") or raw.get("terraform_path"))
    link["access_token"] = (raw.get("access_token") or "").strip()
    link["base_url"] = (raw.get("base_url") or "").strip()
    return link


def normalize_iac_config(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize stored config and migrate legacy github_issues flat fields."""
    cfg = dict(raw or {})
    vcs = (cfg.get("vcs_provider") or "github").strip().lower()
    if vcs not in SUPPORTED_VCS_PROVIDERS:
        vcs = "github"
    cfg["vcs_provider"] = vcs

    owner = (cfg.get("owner") or "").strip()
    repo = (cfg.get("repo") or "").strip()
    repo_ref = (cfg.get("repo_ref") or "").strip()
    if not repo_ref and owner and repo:
        repo_ref = f"{owner}/{repo}"

    if owner and repo and not cfg.get("terraform_repo"):
        cfg["terraform_repo"] = {
            "vcs_provider": vcs,
            "owner": owner,
            "repo": repo,
            "repo_ref": repo_ref,
            "path": cfg.get("terraform_path", DEFAULT_TERRAFORM_PATH),
            "access_token": cfg.get("access_token", ""),
        }
        if cfg.get("terragrunt_path"):
            cfg["uses_terragrunt"] = True
            if not cfg.get("repo_mode"):
                cfg["repo_mode"] = "single"

    uses_terragrunt = bool(cfg.get("uses_terragrunt"))
    repo_mode: RepoMode = cfg.get("repo_mode") or "single"
    if repo_mode not in ("single", "dual"):
        repo_mode = "single"
    cfg["uses_terragrunt"] = uses_terragrunt
    cfg["repo_mode"] = repo_mode

    terraform_repo = _normalize_repo_link(cfg.get("terraform_repo"), default_provider=vcs)
    if not terraform_repo["repo_ref"] and repo_ref:
        terraform_repo["owner"] = owner
        terraform_repo["repo"] = repo
        terraform_repo["repo_ref"] = repo_ref
        terraform_repo["path"] = normalize_repo_path(cfg.get("terraform_path"))
        if cfg.get("access_token"):
            terraform_repo["access_token"] = (cfg.get("access_token") or "").strip()
    cfg["terraform_repo"] = terraform_repo

    terragrunt_repo = _normalize_repo_link(cfg.get("terragrunt_repo"), default_provider=vcs)
    if repo_mode == "single" and uses_terragrunt:
        terragrunt_raw = cfg.get("terragrunt_path")
        if terragrunt_raw is not None and str(terragrunt_raw).strip():
            terragrunt_repo = dict(terraform_repo)
            terragrunt_repo["path"] = normalize_repo_path(terragrunt_raw, default=terraform_repo["path"])
    cfg["terragrunt_repo"] = terragrunt_repo if uses_terragrunt else _blank_repo_link(vcs)

    cfg["terraform_path"] = terraform_repo["path"]
    terragrunt_path_raw = cfg.get("terragrunt_path")
    if uses_terragrunt and repo_mode == "single":
        if terragrunt_path_raw is not None and str(terragrunt_path_raw).strip():
            cfg["terragrunt_path"] = normalize_repo_path(terragrunt_path_raw, default=terraform_repo["path"])
        elif terragrunt_repo["path"] != terraform_repo["path"]:
            cfg["terragrunt_path"] = terragrunt_repo["path"]
        else:
            cfg["terragrunt_path"] = None
    elif uses_terragrunt and repo_mode == "dual":
        cfg["terragrunt_path"] = terragrunt_repo["path"] if terragrunt_repo.get("repo_ref") else None
    else:
        cfg["terragrunt_path"] = None

    cfg["owner"] = terraform_repo.get("owner") or owner
    cfg["repo"] = terraform_repo.get("repo") or repo
    cfg["repo_ref"] = terraform_repo.get("repo_ref") or repo_ref
    if cfg.get("access_token") is None and terraform_repo.get("access_token"):
        cfg["access_token"] = terraform_repo["access_token"]
    cfg["labels"] = cfg.get("labels") or []
    return cfg


def iac_provider(db: Session, org_id: uuid.UUID) -> IdentityProvider | None:
    provider = db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == IAC_REPOSITORY_TYPE,
        )
    )
    if provider:
        return provider
    return db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == LEGACY_GITHUB_ISSUES_TYPE,
        )
    )


def iac_config(db: Session, org_id: uuid.UUID) -> dict[str, Any]:
    provider = iac_provider(db, org_id)
    if not provider:
        return {}
    return normalize_iac_config(provider_config(provider))


def remediation_paths(cfg: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_iac_config(cfg)
    terraform = normalized["terraform_repo"]
    terragrunt = normalized["terragrunt_repo"]
    uses_terragrunt = normalized["uses_terragrunt"]
    repo_mode = normalized["repo_mode"]

    terraform_path = terraform["path"]
    if uses_terragrunt:
        if repo_mode == "dual" and terragrunt.get("repo_ref"):
            terragrunt_path = terragrunt["path"]
            pr_repo = terragrunt
            paths_differ = (
                terragrunt.get("repo_ref") != terraform.get("repo_ref")
                or terragrunt_path != terraform_path
            )
        else:
            terragrunt_path = normalized.get("terragrunt_path") or terraform_path
            pr_repo = terraform
            paths_differ = terragrunt_path != terraform_path
    else:
        terragrunt_path = terraform_path
        pr_repo = terraform
        paths_differ = False

    pr_path = terragrunt_path if uses_terragrunt else terraform_path
    return {
        "terraform_path": terraform_path,
        "terragrunt_path": terragrunt_path,
        "pr_path": pr_path,
        "paths_differ": paths_differ,
        "terraform_repo": terraform,
        "terragrunt_repo": terragrunt if uses_terragrunt else None,
        "pr_repo": pr_repo,
        "repo_mode": repo_mode,
        "uses_terragrunt": uses_terragrunt,
    }


def ticket_target_repo(cfg: dict[str, Any]) -> dict[str, Any]:
    """Repo that receives remediation tickets (Terragrunt live when applicable)."""
    paths = remediation_paths(cfg)
    if paths["uses_terragrunt"] and paths["repo_mode"] == "dual" and paths["terragrunt_repo"].get("repo_ref"):
        return paths["terragrunt_repo"]
    return paths["terraform_repo"]


def github_owner_repo(link: dict[str, Any]) -> tuple[str, str]:
    owner = (link.get("owner") or "").strip()
    repo = (link.get("repo") or "").strip()
    repo_ref = (link.get("repo_ref") or "").strip()
    if owner and repo:
        return owner, repo
    if "/" in repo_ref:
        parts = [part for part in repo_ref.split("/") if part]
        if len(parts) >= 2:
            return parts[0], parts[1]
    return owner, repo


def persist_iac_config(
    db: Session,
    org_id: uuid.UUID,
    config: dict[str, Any],
    *,
    status: str = "connected",
) -> IdentityProvider:
    normalized = normalize_iac_config(config)
    provider = db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == IAC_REPOSITORY_TYPE,
        )
    )
    legacy = db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == LEGACY_GITHUB_ISSUES_TYPE,
        )
    )
    if not provider and legacy:
        legacy.type = IAC_REPOSITORY_TYPE
        provider = legacy
        legacy = None
    if not provider:
        provider = IdentityProvider(org_id=org_id, type=IAC_REPOSITORY_TYPE, status=status)
        db.add(provider)
    set_provider_config(provider, normalized)
    provider.status = status
    if legacy and legacy.id != provider.id:
        db.delete(legacy)
    return provider


def delete_iac_provider(db: Session, org_id: uuid.UUID) -> None:
    for provider_type in (IAC_REPOSITORY_TYPE, LEGACY_GITHUB_ISSUES_TYPE):
        provider = db.scalar(
            select(IdentityProvider).where(
                IdentityProvider.org_id == org_id,
                IdentityProvider.type == provider_type,
            )
        )
        if provider:
            db.delete(provider)


def oauth_provider(db: Session, org_id: uuid.UUID, vcs: VcsProvider) -> IdentityProvider | None:
    provider_type = GITHUB_OAUTH_TYPE if vcs == "github" else GITLAB_OAUTH_TYPE if vcs == "gitlab" else None
    if not provider_type:
        return None
    return db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == provider_type,
        )
    )


def resolve_vcs_token(db: Session, org_id: uuid.UUID, link: dict[str, Any]) -> str:
    token = (link.get("access_token") or "").strip()
    if token:
        return token
    vcs = link.get("vcs_provider", "github")
    installation_id = str(link.get("installation_id") or "").strip()
    if vcs == "github" and (link.get("auth_method") == "github_app" or installation_id):
        if not installation_id:
            raise ValueError("GitHub App installation is required for this IaC repository")
        from app.services.github_app import create_installation_token

        repository_id = str(link.get("repository_id") or "").strip()
        if not repository_id.isdigit():
            raise ValueError("Select an authorized GitHub repository from the GitHub App installation")
        return create_installation_token(
            int(installation_id),
            repository_ids=[int(repository_id)],
            permissions={
                "contents": "write",
                "issues": "write",
                "metadata": "read",
                "pull_requests": "write",
            },
        )
    oauth = oauth_provider(db, org_id, vcs)
    if oauth:
        oauth_cfg = provider_config(oauth)
        token = (oauth_cfg.get("access_token") or "").strip()
    if not token:
        label = str(vcs).replace("_", " ").title()
        raise ValueError(f"Connect {label} OAuth or provide an access token for the IaC repository")
    return token


def resolve_github_token(db: Session, org_id: uuid.UUID, cfg: dict[str, Any]) -> str:
    target = ticket_target_repo(cfg)
    return resolve_vcs_token(db, org_id, target)


_AWS_ACCESS_KEY_RE = re.compile(r"^AKIA[0-9A-Z]{16}$")
_CODECOMMIT_DEFAULT_REGION = "us-east-1"


def parse_azure_devops_repo_link(link: dict[str, Any]) -> tuple[str, str, str]:
    """Return org URL, project name, and repository name from an IaC repo link."""
    repo_ref = (link.get("repo_ref") or "").strip()
    parts = [part for part in repo_ref.split("/") if part]
    base_url = (link.get("base_url") or "").strip()

    if base_url:
        org_url = normalize_azure_devops_org_url(base_url)
        if len(parts) < 2:
            raise ValueError(
                "Azure DevOps repository reference must be project/repo when org URL is set separately"
            )
        project = normalize_azure_devops_project(parts[0])
        repo_name = parts[1]
        return org_url, project, repo_name

    if len(parts) >= 3:
        org_url = normalize_azure_devops_org_url(parts[0])
        project = normalize_azure_devops_project(parts[1])
        return org_url, project, parts[2]

    raise ValueError(
        "Azure DevOps repository reference must be org/project/repo (e.g. myorg/MyProject/my-repo)"
    )


def verify_azure_devops_repo(link: dict[str, Any]) -> None:
    """Confirm PAT works and the Git repository exists."""
    pat = (link.get("access_token") or "").strip()
    if not pat:
        raise ValueError("Azure DevOps personal access token is required")

    org_url, project, repo_name = parse_azure_devops_repo_link(link)
    if not repo_name:
        raise ValueError("Azure DevOps repository name is required")

    token = base64.b64encode(f":{pat}".encode()).decode()
    headers = {"Authorization": f"Basic {token}"}
    project_enc = quote(project, safe="")
    repo_enc = quote(repo_name, safe="")
    url = f"{org_url}/{project_enc}/_apis/git/repositories/{repo_enc}?api-version=7.0"

    with httpx.Client(timeout=30.0, headers=headers) as client:
        resp = client.get(url)
    if resp.status_code >= 400:
        raise ValueError(
            api_access_error(
                "Azure DevOps Git",
                resp.status_code,
                hint="Use org/project/repo (e.g. myorg/MyProject/my-repo) and a PAT with Code read scope.",
            )
        )


def _codecommit_region(link: dict[str, Any]) -> str:
    base = (link.get("base_url") or "").strip()
    if not base:
        return _CODECOMMIT_DEFAULT_REGION
    if "://" in base:
        host = urlparse(base).netloc.lower()
    else:
        host = base.lower().split("/")[0]
    match = re.search(r"git-codecommit\.([a-z0-9-]+)\.amazonaws\.com", host)
    if match:
        return match.group(1)
    if re.fullmatch(r"[a-z]{2}-[a-z]+-\d+", base):
        return base
    raise ValueError(
        "CodeCommit region is required in base_url (e.g. us-east-1 or https://git-codecommit.us-east-1.amazonaws.com)"
    )


def _codecommit_git_credentials(link: dict[str, Any]) -> tuple[str, str]:
    token = (link.get("access_token") or "").strip()
    if not token:
        raise ValueError("CodeCommit Git credentials are required (username:password)")
    if ":" in token:
        username, _, password = token.partition(":")
        username = username.strip()
        password = password.strip()
        if username and password:
            return username, password
    owner = (link.get("owner") or "").strip()
    if owner and token:
        return owner, token
    raise ValueError("CodeCommit Git credentials are required as username:password")


def _verify_codecommit_via_git_https(link: dict[str, Any], *, region: str, repo_name: str) -> None:
    username, password = _codecommit_git_credentials(link)
    auth = base64.b64encode(f"{username}:{password}".encode()).decode()
    repo_enc = quote(repo_name, safe="")
    url = f"https://git-codecommit.{region}.amazonaws.com/v1/repos/{repo_enc}"
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(url, headers={"Authorization": f"Basic {auth}"})
    if resp.status_code >= 400:
        raise ValueError(
            api_access_error(
                "CodeCommit",
                resp.status_code,
                hint="Use repository name and IAM Git credentials (username:password).",
            )
        )


def _verify_codecommit_via_boto3(link: dict[str, Any], *, region: str, repo_name: str) -> None:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError

    token = (link.get("access_token") or "").strip()
    access_key, _, secret_key = token.partition(":")
    if not _AWS_ACCESS_KEY_RE.match(access_key) or not secret_key:
        raise ValueError("CodeCommit AWS credentials must be access_key_id:secret_access_key")

    client = boto3.client(
        "codecommit",
        region_name=region,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
    )
    try:
        client.get_repository(repositoryName=repo_name)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 400)
        if code == "RepositoryDoesNotExistException":
            raise ValueError(api_access_error("CodeCommit", 404)) from exc
        raise ValueError(api_access_error("CodeCommit", status)) from exc
    except BotoCoreError as exc:
        raise ValueError(f"CodeCommit verification failed: {exc}") from exc


def verify_codecommit_repo(link: dict[str, Any]) -> None:
    """Confirm CodeCommit repository is reachable with provided credentials."""
    repo_name = (link.get("repo_ref") or link.get("repo") or "").strip()
    if not repo_name:
        raise ValueError("CodeCommit repository name is required")

    region = _codecommit_region(link)
    token = (link.get("access_token") or "").strip()
    if ":" in token:
        access_key = token.partition(":")[0]
        if _AWS_ACCESS_KEY_RE.match(access_key):
            _verify_codecommit_via_boto3(link, region=region, repo_name=repo_name)
            return
    _verify_codecommit_via_git_https(link, region=region, repo_name=repo_name)


def build_remediation_ticket_body(
    *,
    finding_title: str,
    severity: str,
    check_id: str,
    resource_arn: str,
    finding_url: str,
    cfg: dict[str, Any],
) -> str:
    paths = remediation_paths(cfg)
    terraform = paths["terraform_repo"]
    lines = [
        "Cloud finding remediation — implement as Terraform/Terragrunt changes in the linked IaC repository.",
        "",
        f"Severity: {severity.upper()}",
        f"Check: {check_id}",
        f"Resource: {resource_arn}",
        f"Finding: {finding_title}",
        "",
        "IaC layout:",
        f"- Terraform modules: `{terraform.get('repo_ref')}` @ `{paths['terraform_path']}`",
    ]
    if paths["uses_terragrunt"]:
        terragrunt = paths["terragrunt_repo"] or terraform
        if paths["repo_mode"] == "dual" and terragrunt.get("repo_ref"):
            lines.append(f"- Terragrunt live stacks: `{terragrunt.get('repo_ref')}` @ `{paths['terragrunt_path']}`")
            lines.extend(
                [
                    f"- Suggested PR target: `{terragrunt.get('repo_ref')}` @ `{paths['pr_path']}`",
                    "",
                    "Note: modules and live stacks are in separate repositories — edit modules as needed, "
                    "but open the PR against the Terragrunt repository that owns this environment.",
                ]
            )
        elif paths["paths_differ"]:
            lines.extend(
                [
                    f"- Terragrunt live stacks: `{terraform.get('repo_ref')}` @ `{paths['terragrunt_path']}`",
                    f"- Suggested PR target: `{paths['pr_path']}` (Terragrunt live directory)",
                    "",
                    "Note: modules and live stacks are in different subdirectories — edit modules as needed, "
                    "but open the PR against the Terragrunt path that owns this environment.",
                ]
            )
        else:
            lines.append(f"- Suggested PR target: `{paths['pr_path']}`")
    else:
        lines.append(f"- Suggested PR target: `{terraform.get('repo_ref')}` @ `{paths['pr_path']}`")
    lines.extend(["", f"View in Veritrail: {finding_url}"])
    return "\n".join(lines)
