"""IaC routes: deterministic security lint (scan-only).

Endpoints:
  * POST /scan                    — native security lint (+ optional Checkov/tfsec) over pasted
                                    files or a connected GitHub/GitLab repo.
  * POST /webhook/github          — HMAC-verified GitHub push/PR trigger that scans changed .tf/.hcl.
  * POST /webhook/gitlab          — Token-verified GitLab push/MR trigger that scans changed .tf/.hcl.

Read-only boundary: every path analyzes *source text only*. Nothing here writes to AWS or mutates
a customer repo; the webhook reports findings, humans decide.
"""
from __future__ import annotations

import json
import uuid
from typing import Any

import httpx
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import current_principal
from app.models.github import IdentityProvider, Repo
from app.services.github_repo_tf import fetch_terraform_files
from app.services.github_webhook import changed_iac_paths, event_context, verify_github_signature
from app.services.github_webhook_feedback import post_webhook_feedback
from app.services.gitlab_repo_tf import fetch_terraform_files as fetch_gitlab_terraform_files
from app.services.iac_external_scan import combined_scan

router = APIRouter()

_ALLOWED_ENGINES = {"checkov", "tfsec"}


class TfFileIn(BaseModel):
    path: str = "main.tf"
    content: str


class IacScanIn(BaseModel):
    files: list[TfFileIn] = Field(default_factory=list, max_length=40)
    repo: str | None = None  # owner/name — fetch from the org's connected GitHub integration
    ref: str | None = None
    engines: list[str] = Field(default_factory=list, max_length=2)  # optional: checkov / tfsec


def _supported_provider_for_org(db: Session, org_id: str) -> IdentityProvider | None:
    """Return the first connected IaC-capable provider (GitHub or GitLab) for an org."""
    providers = db.scalars(
        select(IdentityProvider).where(
            IdentityProvider.org_id == uuid.UUID(org_id),
            IdentityProvider.type.in_(["github", "gitlab"]),
            IdentityProvider.status == "connected",
        ).order_by(IdentityProvider.type)
    ).all()
    return providers[0] if providers else None


@router.post("/scan")
def iac_scan(body: IacScanIn, p=Depends(current_principal), db: Session = Depends(get_db)):
    """Run the native deterministic IaC lint (+ optional external engines) over pasted files or a repo.

    Native rules are always on; ``engines`` opt into Checkov/tfsec, which only add findings. Returns a
    severity-sorted summary with per-engine availability so a CI gate can fail on the highest severity.
    """
    files = [{"path": f.path, "content": f.content} for f in body.files]
    if body.repo:
        provider = _supported_provider_for_org(db, p["org_id"])
        if not provider:
            raise HTTPException(status_code=400, detail="No connected GitHub or GitLab integration for this org")
        try:
            if provider.type == "gitlab":
                files = fetch_gitlab_terraform_files(provider, db, body.repo, ref=body.ref)
            else:
                files = fetch_terraform_files(provider, body.repo, ref=body.ref)
        except (ValueError, httpx.HTTPError) as e:
            raise HTTPException(status_code=400, detail=f"Could not fetch repo Terraform: {e}")
    if not files:
        raise HTTPException(status_code=400, detail="No Terraform/HCL files supplied or found")
    engines = [e for e in body.engines if e in _ALLOWED_ENGINES]
    return combined_scan(files, engines)


@router.post("/webhook/github")
async def github_webhook(
    request: Request,
    x_hub_signature_256: str | None = Header(default=None),
    x_github_event: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Inbound GitHub push/PR webhook → scan changed .tf/.hcl. HMAC-verified (fail closed), read-only.

    After scanning, posts results back to GitHub:
      - PR events: posts or updates a PR comment with the findings summary.
      - Push events: creates a check run with the scan result.

    Uses the org's GitHub integration token (write-scoped, from OAuth app). Requires the
    GITHUB_WEBHOOK_SECRET env var to be set.
    """
    settings = get_settings()
    raw = await request.body()
    if not verify_github_signature(settings.GITHUB_WEBHOOK_SECRET, raw, x_hub_signature_256):
        raise HTTPException(status_code=401, detail="invalid or missing signature")
    try:
        event = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid JSON payload")

    if x_github_event not in ("push", "pull_request"):
        return {"status": "ignored", "reason": f"event '{x_github_event}' not handled"}

    ctx = event_context(event)
    changed = changed_iac_paths(event)
    if not ctx["repo"]:
        return {"status": "ignored", "reason": "no repository in payload"}
    if x_github_event == "push" and not changed:
        return {"status": "ignored", "reason": "no .tf/.hcl changes in push", **ctx}

    repo_row = db.scalars(select(Repo).where(Repo.name == ctx["repo"])).first()
    provider = db.get(IdentityProvider, repo_row.provider_id) if repo_row else None
    if not provider:
        return {
            "status": "accepted",
            "reason": "repo not linked to a connected provider; scan skipped",
            "changed_iac_paths": changed,
            **ctx,
        }
    try:
        files = fetch_terraform_files(provider, ctx["repo"], ref=ctx["branch"])
    except (ValueError, httpx.HTTPError) as e:
        return {"status": "error", "reason": f"fetch failed: {e}", **ctx}

    scan_result = combined_scan(files, [])

    # Post results back to GitHub as a PR comment or check run
    feedback = post_webhook_feedback(
        provider,
        repo_row,
        event_type=x_github_event,
        event=event,
        changed_iac_paths=changed,
        scan_result={"status": "scanned", "changed_iac_paths": changed, "result": scan_result, **ctx},
        veritrail_base_url=settings.FRONTEND_URL,
    )

    return {
        "status": "scanned",
        "changed_iac_paths": changed,
        "result": scan_result,
        "feedback": feedback,
        **ctx,
    }


def _gitlab_changed_iac_paths(event: dict) -> list[str]:
    """Distinct .tf/.hcl paths added/modified across a GitLab push/MR event (sorted)."""
    _IAC_SUFFIXES = (".tf", ".hcl")
    paths: set[str] = set()
    # GitLab push events include `commits` array; MR events include `object_attributes`
    commits = (event or {}).get("commits") or []
    for commit in commits:
        for key in ("added", "modified"):
            for p in commit.get(key) or []:
                if isinstance(p, str) and p.endswith(_IAC_SUFFIXES):
                    paths.add(p)
    return sorted(paths)


def _gitlab_event_context(event: dict) -> dict:
    """Repo full name + branch + optional MR IID from a GitLab push or merge_request event."""
    project = (event or {}).get("project") or {}
    repo = project.get("path_with_namespace")
    ref = (event or {}).get("ref")  # push events: "refs/heads/main"
    branch = ref.split("/", 2)[-1] if ref else None
    mr_attrs = (event or {}).get("object_attributes") or {}
    if not branch and mr_attrs:
        branch = mr_attrs.get("source_branch") or mr_attrs.get("target_branch")
    mr_iid = mr_attrs.get("iid")
    return {"repo": repo, "branch": branch, "mr_iid": mr_iid}


@router.post("/webhook/gitlab")
async def gitlab_webhook(
    request: Request,
    x_gitlab_token: str | None = Header(default=None),
    x_gitlab_event: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Inbound GitLab push/MR webhook → scan changed .tf/.hcl. Token-verified, read-only.

    Uses X-Gitlab-Token header for verification (required). Scans changed .tf/.hcl files
    from push and merge_request events. Posts summary as an MR note.

    Configure this URL in GitLab: Project → Settings → Webhooks.
    Requires GITLAB_WEBHOOK_SECRET env var to be set.
    """
    settings = get_settings()
    raw = await request.body()

    # Verify webhook token
    webhook_secret = settings.GITLAB_WEBHOOK_SECRET
    if not webhook_secret or not x_gitlab_token:
        raise HTTPException(status_code=401, detail="invalid or missing webhook token")
    if x_gitlab_token != webhook_secret:
        raise HTTPException(status_code=401, detail="invalid webhook token")

    try:
        event = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid JSON payload")

    event_type = x_gitlab_event or ""
    if event_type not in ("Push Hook", "Merge Request Hook"):
        return {"status": "ignored", "reason": f"event '{event_type}' not handled"}

    ctx = _gitlab_event_context(event)
    changed = _gitlab_changed_iac_paths(event)
    if not ctx["repo"]:
        return {"status": "ignored", "reason": "no repository in payload"}
    if event_type == "Push Hook" and not changed:
        return {"status": "ignored", "reason": "no .tf/.hcl changes in push", **ctx}

    # Find the repo and provider
    repo_row = db.scalars(select(Repo).where(Repo.name == ctx["repo"])).first()
    provider = db.get(IdentityProvider, repo_row.provider_id) if repo_row else None
    if not provider or provider.type != "gitlab":
        return {
            "status": "accepted",
            "reason": "repo not linked to a connected GitLab provider; scan skipped",
            "changed_iac_paths": changed,
            **ctx,
        }
    try:
        files = fetch_gitlab_terraform_files(provider, db, ctx["repo"], ref=ctx["branch"])
    except (ValueError, httpx.HTTPError) as e:
        return {"status": "error", "reason": f"fetch failed: {e}", **ctx}

    scan_result = combined_scan(files, [])

    # Post results as MR note if applicable
    feedback: dict[str, Any] | None = None
    mr_attrs = (event or {}).get("object_attributes") or {}
    mr_iid = mr_attrs.get("iid") or ctx.get("mr_iid")
    if mr_iid and scan_result:
        from app.services.gitlab_tokens import ensure_gitlab_token
        from app.services.gitlab_sync import provider_config

        try:
            token = ensure_gitlab_token(db, provider)
            config = provider_config(provider)
            base = (config.get("base_url") or "https://gitlab.com").rstrip("/")
            api = f"{base}/api/v4"
            from urllib.parse import quote

            project_path = quote(ctx["repo"], safe="")

            # Build findings summary
            native = scan_result.get("native") or {}
            external = scan_result.get("external") or {}
            total = native.get("total_findings", 0) + external.get("total_findings", 0)
            critical_or_high = native.get("high", 0) + external.get("high", 0)

            note_body = (
                f"## 🔍 Veritrail IaC Scan Results\n\n"
                f"**{total} finding(s)** detected in changed `.tf`/`.hcl` files.\n\n"
            )
            if critical_or_high:
                note_body += f"⚠️ **{critical_or_high} high-severity** findings require attention.\n\n"
            note_body += (
                f"View full details in Veritrail: {settings.FRONTEND_URL}/dashboard/iac\n\n"
                f"---\n*Scan performed by Veritrail IaC security lint.*"
            )

            with httpx.Client(headers={"Authorization": f"Bearer {token}"}, timeout=20) as client:
                # Get project ID
                proj_resp = client.get(f"{api}/projects/{project_path}")
                proj_resp.raise_for_status()
                project_id = proj_resp.json()["id"]

                note_resp = client.post(
                    f"{api}/projects/{project_id}/merge_requests/{mr_iid}/notes",
                    json={"body": note_body},
                )
                if note_resp.is_success:
                    feedback = {"posted": True, "note_id": note_resp.json().get("id")}
                else:
                    feedback = {"posted": False, "error": note_resp.text[:200]}
        except Exception:
            feedback = {"posted": False, "error": "failed to post MR note"}

    return {
        "status": "scanned",
        "changed_iac_paths": changed,
        "result": scan_result,
        "feedback": feedback,
        **ctx,
    }
