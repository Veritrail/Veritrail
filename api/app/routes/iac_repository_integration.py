"""IaC repository integration — link Terraform/Terragrunt repos for finding remediation."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import get_settings
from app.core.db import get_db
from app.core.org_context import resolve_org
from app.core.route_deps import RequireAdmin
from app.core.security import current_principal
from app.models.finding import Finding, FindingEvent
from app.models.org import Org
from app.services.digest import _findings_app_url
from app.services.github_issues_client import GitHubIssuesClient, normalize_github_repo_ref
from app.services.github_sync import provider_config
from app.services.iac_repository import (
    SUPPORTED_VCS_PROVIDERS,
    VcsProvider,
    build_remediation_ticket_body,
    delete_iac_provider,
    github_owner_repo,
    iac_config,
    iac_provider,
    normalize_iac_config,
    normalize_repo_path,
    oauth_provider,
    persist_iac_config,
    remediation_paths,
    resolve_github_token,
    ticket_target_repo,
)

router = APIRouter()
settings = get_settings()


def _github_app_state(user_id: str, org_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "type": "iac_github_app_install",
        "sub": user_id,
        "org_id": org_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=15)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)


def _decode_github_app_state(state: str | None) -> dict:
    if not state:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "missing state")
    try:
        payload = jwt.decode(state, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
    except JWTError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"bad state: {e}") from e
    if payload.get("type") != "iac_github_app_install":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad state type")
    return payload


def _get_org(p, db: Session) -> Org:
    return resolve_org(db, p)


class RepoLinkOut(BaseModel):
    vcs_provider: VcsProvider
    repo_ref: str
    auth_method: str | None = None
    installation_id: str | None = None
    installation_account: str | None = None
    repository_id: str | None = None
    owner: str | None = None
    repo: str | None = None
    path: str = "."
    has_access_token: bool = False
    base_url: str | None = None


class IacRepositoryOut(BaseModel):
    connected: bool
    status: str
    vcs_provider: VcsProvider | None = None
    uses_terragrunt: bool = False
    repo_mode: Literal["single", "dual"] = "single"
    terraform_repo: RepoLinkOut | None = None
    terragrunt_repo: RepoLinkOut | None = None
    repo_ref: str | None = None
    owner: str | None = None
    repo: str | None = None
    terraform_path: str = "."
    terragrunt_path: str | None = None
    paths_differ: bool = False
    pr_path: str | None = None
    labels: list[str] = []
    has_access_token: bool = False
    github_app_configured: bool = False
    github_app_installed: bool = False
    github_app_account: str | None = None
    github_app_installation_id: str | None = None
    github_app_manage_url: str | None = None
    github_app_repository_selection: str | None = None
    github_oauth_connected: bool = False
    github_oauth_login: str | None = None
    remediation_available: bool = False
    remediation_unavailable_reason: str | None = None


class RepoLinkIn(BaseModel):
    vcs_provider: VcsProvider | None = None
    auth_method: str | None = None
    installation_id: str | int | None = None
    installation_account: str | None = None
    repository_id: str | int | None = None
    owner: str = ""
    repo: str = ""
    repo_ref: str | None = None
    path: str | None = None
    access_token: str | None = None
    base_url: str | None = None


class IacRepositoryIn(BaseModel):
    vcs_provider: VcsProvider = "github"
    uses_terragrunt: bool = False
    repo_mode: Literal["single", "dual"] = "single"
    terraform_repo: RepoLinkIn | None = None
    terragrunt_repo: RepoLinkIn | None = None
    owner: str = ""
    repo: str = ""
    repo_ref: str | None = None
    terraform_path: str | None = None
    terragrunt_path: str | None = None
    access_token: str | None = None
    labels: list[str] | None = None


class RemediationTicketOut(BaseModel):
    issue_key: str
    issue_url: str


class InstallUrlOut(BaseModel):
    url: str


class GitHubAppRepoOut(BaseModel):
    id: int
    full_name: str
    private: bool
    default_branch: str | None = None
    html_url: str | None = None


def _repo_link_out(link: dict) -> RepoLinkOut:
    owner, repo = github_owner_repo(link)
    return RepoLinkOut(
        vcs_provider=link.get("vcs_provider", "github"),
        repo_ref=link.get("repo_ref") or "",
        auth_method=link.get("auth_method") or None,
        installation_id=str(link.get("installation_id") or "") or None,
        installation_account=link.get("installation_account") or None,
        repository_id=str(link.get("repository_id") or "") or None,
        owner=owner or None,
        repo=repo or None,
        path=link.get("path") or ".",
        has_access_token=bool(link.get("access_token")),
        base_url=link.get("base_url") or None,
    )


def _github_oauth_status(db: Session, org_id: uuid.UUID) -> tuple[bool, str | None]:
    oauth = oauth_provider(db, org_id, "github")
    if not oauth:
        return False, None
    oauth_cfg = provider_config(oauth)
    token = (oauth_cfg.get("access_token") or "").strip()
    if not token:
        return False, None
    return True, oauth_cfg.get("login") or None


def _out_from_provider(provider, db: Session) -> IacRepositoryOut:
    from app.services.github_app import github_app_configured

    cfg = normalize_iac_config(provider_config(provider))
    oauth_connected, oauth_login = _github_oauth_status(db, provider.org_id)
    paths = remediation_paths(cfg)
    terraform = cfg["terraform_repo"]
    terragrunt = cfg["terragrunt_repo"] if cfg["uses_terragrunt"] else None
    vcs = cfg["vcs_provider"]
    github_app = cfg.get("github_app") or {}
    connected = bool(terraform.get("repo_ref"))
    remediation_available = connected and vcs in ("github",)
    unavailable_reason = None
    if connected and not remediation_available:
        unavailable_reason = f"{vcs.replace('_', ' ').title()} remediation tickets are coming soon"
    owner, repo = github_owner_repo(terraform)
    return IacRepositoryOut(
        connected=connected,
        status=provider.status,
        vcs_provider=vcs,
        uses_terragrunt=cfg["uses_terragrunt"],
        repo_mode=cfg["repo_mode"],
        terraform_repo=_repo_link_out(terraform),
        terragrunt_repo=_repo_link_out(terragrunt) if terragrunt and terragrunt.get("repo_ref") else None,
        repo_ref=terraform.get("repo_ref") or None,
        owner=owner or None,
        repo=repo or None,
        terraform_path=paths["terraform_path"],
        terragrunt_path=paths["terragrunt_path"] if paths["uses_terragrunt"] and paths["paths_differ"] else None,
        paths_differ=paths["paths_differ"],
        pr_path=paths["pr_path"],
        labels=cfg.get("labels") or [],
        has_access_token=bool(terraform.get("access_token")),
        github_app_configured=github_app_configured(),
        github_app_installed=bool(github_app.get("installation_id")),
        github_app_account=github_app.get("account_login") or terraform.get("installation_account") or None,
        github_app_installation_id=str(github_app.get("installation_id") or terraform.get("installation_id") or "") or None,
        github_app_manage_url=github_app.get("html_url") or None,
        github_app_repository_selection=github_app.get("repository_selection") or None,
        github_oauth_connected=oauth_connected,
        github_oauth_login=oauth_login,
        remediation_available=remediation_available,
        remediation_unavailable_reason=unavailable_reason,
    )


def _not_configured(db: Session, org_id: uuid.UUID) -> IacRepositoryOut:
    from app.services.github_app import github_app_configured

    oauth_connected, oauth_login = _github_oauth_status(db, org_id)
    return IacRepositoryOut(
        connected=False,
        status="not_configured",
        github_app_configured=github_app_configured(),
        github_oauth_connected=oauth_connected,
        github_oauth_login=oauth_login,
    )


def _gitlab_api_base(base_url: str | None) -> str:
    base = (base_url or "https://gitlab.com").rstrip("/")
    return f"{base}/api/v4"


def _verify_gitlab_repo(db: Session, org_id: uuid.UUID, link: dict) -> None:
    from app.services.iac_repository import resolve_vcs_token

    owner, repo = github_owner_repo(link)
    project = link.get("repo_ref") or (f"{owner}/{repo}" if owner and repo else "")
    if not project:
        raise ValueError("GitLab project path is required (e.g. group/project)")
    token = resolve_vcs_token(db, org_id, link)
    encoded = project.replace("/", "%2F")
    api = _gitlab_api_base(link.get("base_url"))
    with httpx.Client(timeout=20) as client:
        resp = client.get(f"{api}/projects/{encoded}", headers={"Authorization": f"Bearer {token}"})
    if resp.status_code >= 400:
        raise ValueError(f"GitLab project not accessible ({resp.status_code})")


def _verify_repo_link(db: Session, org_id: uuid.UUID, link: dict) -> None:
    from app.services.iac_repository import resolve_vcs_token

    vcs = link.get("vcs_provider", "github")
    if vcs == "github":
        owner, repo = github_owner_repo(link)
        owner, repo = normalize_github_repo_ref(owner, repo)
        if not owner or not repo:
            raise ValueError("GitHub owner and repo are required")
        link["owner"] = owner
        link["repo"] = repo
        link["repo_ref"] = f"{owner}/{repo}"
        token = resolve_vcs_token(db, org_id, link)
        GitHubIssuesClient(token=token).verify(owner, repo)
        return
    if vcs == "gitlab":
        _verify_gitlab_repo(db, org_id, link)
        return
    if not link.get("repo_ref"):
        raise ValueError("repo_ref is required")


def _merge_repo_link(
    incoming: RepoLinkIn | None,
    existing: dict,
    *,
    default_vcs: VcsProvider,
    default_path: str,
) -> dict:
    base = dict(existing) if existing else {}
    if not incoming:
        return base
    link = dict(base)
    link["vcs_provider"] = incoming.vcs_provider or default_vcs
    if incoming.auth_method is not None:
        link["auth_method"] = incoming.auth_method.strip()
    if incoming.installation_id is not None and str(incoming.installation_id).strip():
        link["installation_id"] = str(incoming.installation_id).strip()
    if incoming.installation_account is not None:
        link["installation_account"] = incoming.installation_account.strip()
    if incoming.repository_id is not None and str(incoming.repository_id).strip():
        link["repository_id"] = str(incoming.repository_id).strip()
    if incoming.owner.strip():
        link["owner"] = incoming.owner.strip()
    if incoming.repo.strip():
        link["repo"] = incoming.repo.strip()
    if incoming.repo_ref and incoming.repo_ref.strip():
        link["repo_ref"] = incoming.repo_ref.strip()
    if incoming.path is not None:
        link["path"] = normalize_repo_path(incoming.path, default=default_path)
    if incoming.access_token and incoming.access_token.strip():
        link["access_token"] = incoming.access_token.strip()
    if incoming.base_url is not None:
        link["base_url"] = incoming.base_url.strip()
    return link


def _prepare_github_repo_link(
    db: Session,
    org_id: uuid.UUID,
    link: dict,
    github_app: dict,
    *,
    fallback_owner: str = "",
) -> None:
    if (link.get("access_token") or "").strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "GitHub IaC linking does not accept pasted tokens. Connect GitHub under Integrations → Source control.",
        )

    auth_method = (link.get("auth_method") or "").strip()
    installation_id = str(link.get("installation_id") or "").strip()
    repository_id = str(link.get("repository_id") or "").strip()
    oauth_connected, _ = _github_oauth_status(db, org_id)

    def _apply_github_app() -> None:
        app_installation = installation_id or str(github_app.get("installation_id") or "").strip()
        if not app_installation:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Install the Veritrail GitHub App before linking a GitHub IaC repository.",
            )
        if not repository_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Select an authorized GitHub repository from the GitHub App installation.",
            )
        link["auth_method"] = "github_app"
        link["installation_id"] = app_installation
        link["installation_account"] = link.get("installation_account") or github_app.get("account_login") or fallback_owner

    if auth_method == "github_app" or (installation_id and repository_id):
        _apply_github_app()
        return

    if auth_method == "oauth" or (oauth_connected and not installation_id):
        if not oauth_connected:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Connect GitHub under Integrations → Source control before linking an IaC repository.",
            )
        owner, repo = github_owner_repo(link)
        if not owner or not repo:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "GitHub owner and repository are required.")
        link["auth_method"] = "oauth"
        link["installation_id"] = ""
        link["installation_account"] = ""
        link["repository_id"] = ""
        return

    if github_app.get("installation_id"):
        _apply_github_app()
        return

    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        "Connect GitHub under Integrations → Source control, or install the Veritrail GitHub App.",
    )


@router.get("/iac-repository/github-app/install-url", response_model=InstallUrlOut)
def github_app_install_url(p=Depends(current_principal)):
    from app.services.github_app import installation_url

    try:
        url = installation_url(_github_app_state(p["sub"], p["org_id"]))
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    return InstallUrlOut(url=url)


@router.get("/iac-repository/github-app/setup")
def github_app_setup(
    installation_id: int | None = None,
    setup_action: str | None = None,
    state: str | None = None,
    db: Session = Depends(get_db),
):
    from app.services.github_app import get_installation

    try:
        payload = _decode_github_app_state(state)
        if not installation_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "missing installation_id")
        installation = get_installation(installation_id)
        account = installation.get("account") or {}
        org_id = uuid.UUID(payload["org_id"])
        existing = normalize_iac_config(iac_config(db, org_id))
        existing["github_app"] = {
            "installation_id": str(installation_id),
            "account_login": account.get("login"),
            "account_type": account.get("type"),
            "repository_selection": installation.get("repository_selection"),
            "html_url": installation.get("html_url"),
            "setup_action": setup_action or "",
        }
        persist_iac_config(db, org_id, existing, status="pending")
        db.commit()
        return RedirectResponse(f"{settings.FRONTEND_URL}/integrations/iac-repository?manage=1&github_app=installed")
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        db.rollback()
        return RedirectResponse(f"{settings.FRONTEND_URL}/integrations/iac-repository?manage=1&github_app=error")


@router.get("/iac-repository/github-app/repositories", response_model=list[GitHubAppRepoOut])
def list_github_app_repositories(p=Depends(current_principal), db: Session = Depends(get_db)):
    from app.services.github_app import paginate_installation_repositories

    org = _get_org(p, db)
    cfg = normalize_iac_config(iac_config(db, org.id))
    installation_id = str((cfg.get("github_app") or {}).get("installation_id") or "").strip()
    if not installation_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "GitHub App is not installed")
    try:
        repos = paginate_installation_repositories(int(installation_id))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not list GitHub App repositories: {e}") from e
    return [
        GitHubAppRepoOut(
            id=int(repo["id"]),
            full_name=repo["full_name"],
            private=bool(repo.get("private")),
            default_branch=repo.get("default_branch"),
            html_url=repo.get("html_url"),
        )
        for repo in repos
        if repo.get("id") and repo.get("full_name")
    ]


@router.get("/iac-repository", response_model=IacRepositoryOut)
def get_iac_repository(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    provider = iac_provider(db, org.id)
    if not provider:
        return _not_configured(db, org.id)
    return _out_from_provider(provider, db)


@router.put("/iac-repository", response_model=IacRepositoryOut)
def put_iac_repository(
    body: IacRepositoryIn,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    if body.vcs_provider not in SUPPORTED_VCS_PROVIDERS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unsupported vcs_provider: {body.vcs_provider}")

    existing_provider = iac_provider(db, org.id)
    existing = normalize_iac_config(iac_config(db, org.id)) if existing_provider else {}

    config: dict = {
        "vcs_provider": body.vcs_provider,
        "uses_terragrunt": body.uses_terragrunt,
        "repo_mode": body.repo_mode,
        "labels": existing.get("labels") or [],
    }
    if existing.get("github_app"):
        config["github_app"] = existing.get("github_app")

    terraform_existing = existing.get("terraform_repo") or {}
    terraform = _merge_repo_link(
        body.terraform_repo,
        terraform_existing,
        default_vcs=body.vcs_provider,
        default_path=normalize_repo_path(body.terraform_path or terraform_existing.get("path")),
    )

    if body.terraform_repo is None and (body.owner or body.repo or body.repo_ref):
        flat = RepoLinkIn(
            vcs_provider=body.vcs_provider,
            owner=body.owner,
            repo=body.repo,
            repo_ref=body.repo_ref,
            path=body.terraform_path,
            access_token=body.access_token,
        )
        terraform = _merge_repo_link(flat, terraform, default_vcs=body.vcs_provider, default_path=".")

    if body.vcs_provider == "github":
        owner, repo = normalize_github_repo_ref(terraform.get("owner", ""), terraform.get("repo", "") or terraform.get("repo_ref", ""))
        if owner and repo:
            terraform["owner"] = owner
            terraform["repo"] = repo
            terraform["repo_ref"] = f"{owner}/{repo}"
        github_app = config.get("github_app") or {}
        _prepare_github_repo_link(db, org.id, terraform, github_app, fallback_owner=owner)
    elif not terraform.get("repo_ref"):
        repo_ref = (body.repo_ref or "").strip()
        if repo_ref:
            terraform["repo_ref"] = repo_ref

    from app.services.iac_path_infer import apply_inferred_path

    incoming_tf_path = None
    if body.terraform_repo and body.terraform_repo.path is not None:
        incoming_tf_path = body.terraform_repo.path
    elif body.terraform_path is not None:
        incoming_tf_path = body.terraform_path

    terraform_layout = apply_inferred_path(
        db,
        org.id,
        terraform,
        existing_link=terraform_existing,
        incoming_path=incoming_tf_path,
        uses_terragrunt=body.uses_terragrunt,
    )

    if not terraform.get("repo_ref"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Terraform repository reference is required")

    config["terraform_repo"] = terraform
    config["terraform_path"] = terraform["path"]

    if body.uses_terragrunt:
        terragrunt_existing = existing.get("terragrunt_repo") or {}
        if body.repo_mode == "dual":
            terragrunt = _merge_repo_link(
                body.terragrunt_repo,
                terragrunt_existing,
                default_vcs=body.vcs_provider,
                default_path=".",
            )
            if not terragrunt.get("repo_ref"):
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Terragrunt repository reference is required in dual-repo mode")
            if body.vcs_provider == "github":
                github_app = config.get("github_app") or {}
                _prepare_github_repo_link(db, org.id, terragrunt, github_app)
            incoming_tg_path = body.terragrunt_repo.path if body.terragrunt_repo else None
            apply_inferred_path(
                db,
                org.id,
                terragrunt,
                existing_link=terragrunt_existing,
                incoming_path=incoming_tg_path,
                uses_terragrunt=True,
            )
            config["terragrunt_repo"] = terragrunt
            config["terragrunt_path"] = terragrunt.get("path")
        else:
            terragrunt_path = body.terragrunt_path
            if terragrunt_path is not None and terragrunt_path.strip():
                config["terragrunt_path"] = terragrunt_path.strip()
            elif terraform_layout and terraform_layout.get("paths_differ"):
                config["terragrunt_path"] = terraform_layout["terragrunt_path"]
            elif body.terraform_repo and body.terraform_repo.path:
                pass
            elif existing.get("terragrunt_path"):
                config["terragrunt_path"] = existing.get("terragrunt_path")
    else:
        config["terragrunt_path"] = None

    if body.labels is not None:
        config["labels"] = [label.strip() for label in body.labels if label.strip()]

    normalized = normalize_iac_config(config)
    try:
        _verify_repo_link(db, org.id, normalized["terraform_repo"])
        if normalized["uses_terragrunt"] and normalized["repo_mode"] == "dual":
            _verify_repo_link(db, org.id, normalized["terragrunt_repo"])
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Repository verify failed: {e}") from e

    provider = persist_iac_config(db, org.id, normalized)
    db.commit()
    db.refresh(provider)
    return _out_from_provider(provider, db)


@router.delete("/iac-repository", status_code=204)
def delete_iac_repository(_rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    delete_iac_provider(db, org.id)
    db.commit()


@router.post("/iac-repository/from-finding/{finding_id}", response_model=RemediationTicketOut)
def create_remediation_ticket_from_finding(
    finding_id: uuid.UUID,
    _rbac: RequireAdmin,
    p=Depends(current_principal),
    db: Session = Depends(get_db),
):
    org = _get_org(p, db)
    provider = iac_provider(db, org.id)
    if not provider or provider.status != "connected":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "IaC repository is not connected")

    finding = db.get(Finding, finding_id)
    if not finding or finding.org_id != org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Finding not found")

    cfg = normalize_iac_config(iac_config(db, org.id))
    target = ticket_target_repo(cfg)
    if target.get("vcs_provider") != "github":
        raise HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED,
            f"Remediation tickets for {target.get('vcs_provider')} are coming soon",
        )

    if finding.remediation_ticket_key and finding.remediation_ticket_url:
        return RemediationTicketOut(
            issue_key=finding.remediation_ticket_key,
            issue_url=finding.remediation_ticket_url,
        )

    existing = (finding.evidence or {}).get("iac_remediation_ticket") or (finding.evidence or {}).get("github_issue")
    if isinstance(existing, dict) and existing.get("issue_key"):
        finding.remediation_ticket_key = existing["issue_key"]
        finding.remediation_ticket_url = existing.get("issue_url")
        db.commit()
        return RemediationTicketOut(issue_key=existing["issue_key"], issue_url=existing["issue_url"])

    app_url = _findings_app_url().rstrip("/")
    finding_url = f"{app_url}/findings?finding={finding.id}"
    description = build_remediation_ticket_body(
        finding_title=finding.title,
        severity=finding.severity,
        check_id=finding.check_id,
        resource_arn=finding.resource_arn,
        finding_url=finding_url,
        cfg=cfg,
    )
    owner, repo = github_owner_repo(target)
    try:
        token = resolve_github_token(db, org.id, cfg)
        created = GitHubIssuesClient(token=token).create_issue(
            owner=owner,
            repo=repo,
            title=finding.title,
            body=description,
            labels=cfg.get("labels") or None,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Remediation ticket create failed: {e}") from e

    evidence = dict(finding.evidence or {})
    evidence["iac_remediation_ticket"] = created
    evidence["github_issue"] = created
    finding.evidence = evidence
    flag_modified(finding, "evidence")
    finding.remediation_ticket_key = created["issue_key"]
    finding.remediation_ticket_url = created["issue_url"]
    db.add(
        FindingEvent(
            id=uuid.uuid4(),
            finding_id=finding.id,
            action="note",
            note=f"IaC remediation ticket {created['issue_key']}",
        )
    )
    db.commit()
    return RemediationTicketOut(**created)
