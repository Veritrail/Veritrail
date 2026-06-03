"""GitHub webhook helpers for the IaC PR/push scan trigger (deepsearch v5).

Pure, side-effect-free functions: HMAC-SHA256 signature verification + extraction of changed
.tf/.hcl paths and repo context from a push / pull_request event. The route does the fetching and
scanning; this module stays unit-testable in isolation.

Read-only boundary: a webhook only *triggers a scan of code text*. Vigil reports results back; it
never writes to AWS and never pushes commits or mutates the customer repo.
"""
from __future__ import annotations

import hashlib
import hmac

_IAC_SUFFIXES = (".tf", ".hcl")


def verify_github_signature(secret: str, payload: bytes, signature_header: str | None) -> bool:
    """Constant-time verify of the ``X-Hub-Signature-256`` header.

    Fails closed: returns False when no secret is configured, the header is absent, or it is not a
    ``sha256=...`` digest. Uses ``hmac.compare_digest`` to avoid timing leaks.
    """
    if not secret or not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)


def changed_iac_paths(event: dict) -> list[str]:
    """Distinct .tf/.hcl paths added/modified across a push event's commits (sorted)."""
    paths: set[str] = set()
    for commit in (event or {}).get("commits") or []:
        for key in ("added", "modified"):
            for p in commit.get(key) or []:
                if isinstance(p, str) and p.endswith(_IAC_SUFFIXES):
                    paths.add(p)
    return sorted(paths)


def event_context(event: dict) -> dict:
    """Repo full name + branch + optional PR number from a push or pull_request event."""
    repo = ((event or {}).get("repository") or {}).get("full_name")
    ref = (event or {}).get("ref")  # push events: "refs/heads/main"
    branch = ref.split("/", 2)[-1] if ref else None
    pr = (event or {}).get("pull_request") or {}
    if not branch and pr:
        branch = (pr.get("head") or {}).get("ref")
    pr_number = (event or {}).get("number") or pr.get("number")
    return {"repo": repo, "branch": branch, "pr_number": pr_number}
