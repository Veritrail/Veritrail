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

import uuid
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.github import IdentityProvider
from app.services.github_sync import provider_config, set_provider_config

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
