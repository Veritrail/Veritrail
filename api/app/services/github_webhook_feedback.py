"""Post IaC scan results back to GitHub as a PR comment or check run.

Reuses the existing GitHub integration token (from the org's IdentityProvider)
to post findings after a push/PR webhook triggers an IaC scan.

Read-only boundary: the scan was already done by the webhook endpoint;
this module only formats and posts the results.
"""
from __future__ import annotations

from typing import Any

import httpx

from app.models.github import IdentityProvider, Repo
from app.services.github_sync import GITHUB_API, provider_config


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _findings_summary_text(
    repo: str,
    branch: str,
    result: dict,
    vigil_base_url: str = "",
) -> str:
    """Build a human-readable Markdown comment from scan results."""
    scan_result = result.get("result", {})
    findings = scan_result.get("findings", [])
    native = scan_result.get("native", {})
    checkov = scan_result.get("checkov_set", {})
    tfsec = scan_result.get("tfsec_set", {})

    if not findings and native.get("finding_count", 0) == 0:
        lines = [
            f"## 🔒 Vigil IaC Scan — {repo}@{branch}",
            "",
            "✅ **No security issues found** in the changed Terraform files.",
            "",
            "---",
            "*Scanned by [Vigil]({vigil_base_url}) — cloud security posture*",
        ]
        return "\n".join(lines)

    # Count by severity
    sev_counts: dict[str, int] = {}
    for f in findings:
        sev = f.get("severity", "unknown")
        sev_counts[sev] = sev_counts.get(sev, 0) + 1

    lines = [
        f"## 🔒 Vigil IaC Scan — {repo}@{branch}",
        "",
        f"### Summary: {len(findings)} finding(s)",
        "",
        "| Severity | Count |",
        "|----------|-------|",
    ]
    for sev in ("critical", "high", "medium", "low"):
        count = sev_counts.get(sev, 0)
        if count:
            lines.append(f"| {sev} | {count} |")

    lines.append("")
    lines.append("### Findings by file")
    lines.append("")

    # Group findings by file
    by_file: dict[str, list[dict]] = {}
    for f in findings:
        path = f.get("file", "unknown")
        by_file.setdefault(path, []).append(f)

    for path, ff in sorted(by_file.items()):
        lines.append(f"**`{path}`**")
        for f in ff:
            sev = f.get("severity", "unknown")
            sev_emoji = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "⚪"}.get(sev, "⚪")
            title = f.get("title", f.get("check_id", "unknown"))
            lines.append(f"- {sev_emoji} **{sev}**: {title}")
        lines.append("")

    # Engine status
    engines = []
    if native.get("available"):
        engines.append(f"Native rules: {native.get('finding_count', 0)} findings")
    if checkov.get("available"):
        engines.append(f"Checkov: {checkov.get('finding_count', 0)} findings")
    else:
        engines.append("Checkov: not available")
    if tfsec.get("available"):
        engines.append(f"tfsec: {tfsec.get('finding_count', 0)} findings")
    else:
        engines.append("tfsec: not available")

    lines.append("### Scan engines")
    for e in engines:
        lines.append(f"- {e}")

    vigil_link = f" ([view in Vigil]({vigil_base_url}))" if vigil_base_url else ""
    lines.append("")
    lines.append(
        f"---\n"
        f"*Scanned by [Vigil]{vigil_link} — cloud security posture management*\n"
        f"*Last updated: automated IaC scan on push/PR*"
    )

    return "\n".join(lines)


def _check_run_text(
    repo: str,
    branch: str,
    result: dict,
) -> tuple[str, str, str]:
    """Return (title, summary, text) for a GitHub Check Run."""
    scan_result = result.get("result", {})
    findings = scan_result.get("findings", [])
    native = scan_result.get("native", {})

    total = len(findings) or native.get("finding_count", 0)
    if total == 0:
        return (
            "Vigil IaC Scan: Passed",
            "No security issues found ✅",
            f"No IaC security issues detected in {repo}@{branch}.",
        )

    sev_counts: dict[str, int] = {}
    for f in findings:
        sev = f.get("severity", "unknown")
        sev_counts[sev] = sev_counts.get(sev, 0) + 1

    has_critical = sev_counts.get("critical", 0) > 0
    has_high = sev_counts.get("high", 0) > 0
    conclusion = "failure" if (has_critical or has_high) else "neutral"

    title = f"Vigil IaC Scan: {total} finding(s)"
    summary_parts = []
    for sev in ("critical", "high", "medium", "low"):
        count = sev_counts.get(sev, 0)
        if count:
            summary_parts.append(f"{count} {sev}")
    summary = ", ".join(summary_parts) if summary_parts else "Passed"

    text = _findings_summary_text(repo, branch, result)
    return title, summary, text


def _scan_comment_marker() -> str:
    """Return a hidden marker used to find and update existing Vigil scan comments."""
    return "<!-- vigil-iac-scan -->"


def _find_existing_comment_id(client: httpx.Client, owner: str, repo: str, pr_number: int) -> int | None:
    """Find an existing Vigil bot comment on the PR."""
    params: dict[str, Any] = {"per_page": 100}
    url = f"{GITHUB_API}/repos/{owner}/{repo}/issues/{pr_number}/comments"
    while url:
        resp = client.get(url, params=params)
        if resp.status_code != 200:
            break
        for comment in resp.json():
            if isinstance(comment, dict) and _scan_comment_marker() in (comment.get("body") or ""):
                return comment["id"]
        url = resp.links.get("next", {}).get("url")
        params = {}
    return None


def _post_pr_comment(
    client: httpx.Client,
    owner: str,
    repo: str,
    pr_number: int,
    comment_text: str,
) -> dict:
    """Create or update a PR comment with scan results."""
    body = f"{_scan_comment_marker()}\n{comment_text}"
    existing_id = _find_existing_comment_id(client, owner, repo, pr_number)

    if existing_id is not None:
        resp = client.patch(
            f"{GITHUB_API}/repos/{owner}/{repo}/issues/comments/{existing_id}",
            json={"body": body},
        )
        resp.raise_for_status()
        return {"action": "updated", "comment_id": existing_id, "comment_url": resp.json().get("html_url")}

    resp = client.post(
        f"{GITHUB_API}/repos/{owner}/{repo}/issues/{pr_number}/comments",
        json={"body": body},
    )
    resp.raise_for_status()
    return {"action": "created", "comment_id": resp.json()["id"], "comment_url": resp.json().get("html_url")}


def _post_check_run(
    client: httpx.Client,
    owner: str,
    repo: str,
    head_sha: str,
    title: str,
    summary: str,
    text: str,
    conclusion: str = "neutral",
) -> dict:
    """Create a GitHub Check Run for the push event."""
    resp = client.post(
        f"{GITHUB_API}/repos/{owner}/{repo}/check-runs",
        json={
            "name": "Vigil IaC Scan",
            "head_sha": head_sha,
            "status": "completed",
            "conclusion": conclusion,
            "output": {
                "title": title,
                "summary": summary,
                "text": text,
            },
        },
    )
    resp.raise_for_status()
    return {"action": "created", "check_run_id": resp.json()["id"], "check_run_url": resp.json().get("html_url")}


def post_webhook_feedback(
    provider: IdentityProvider,
    repo_row: Repo | None,
    *,
    event_type: str,
    event: dict,
    changed_iac_paths: list[str],
    scan_result: dict,
    vigil_base_url: str,
) -> dict[str, Any]:
    """Post IaC scan results back to the GitHub PR or push.

    - PR event (pull_request): finds or updates a PR comment.
    - Push event: creates a check run.

    Returns a dict with the action taken and any error info.
    """
    cfg = provider_config(provider)
    token = cfg.get("access_token")
    if not token:
        return {
            "feedback": "skipped",
            "reason": "GitHub integration has no access token — reconnect in Integrations",
        }

    ctx = {
        "repo": ((event or {}).get("repository") or {}).get("full_name"),
        "branch": None,
        "pr_number": (event or {}).get("number") or ((event or {}).get("pull_request") or {}).get("number"),
    }
    if not ctx.get("branch"):
        ref = (event or {}).get("ref", "")
        ctx["branch"] = ref.split("/", 2)[-1] if ref else None

    if "/" not in (ctx["repo"] or ""):
        return {"feedback": "skipped", "reason": "no valid repository in event"}

    owner, repo = ctx["repo"].split("/", 1)

    with httpx.Client(headers=_headers(token), timeout=30) as client:
        try:
            if event_type == "pull_request" and ctx["pr_number"]:
                comment_text = _findings_summary_text(
                    ctx["repo"], ctx["branch"] or "unknown", scan_result, vigil_base_url
                )
                posted = _post_pr_comment(client, owner, repo, ctx["pr_number"], comment_text)
                return {"feedback": posted["action"], "pr_comment_url": posted.get("comment_url"), **posted}
            elif event_type == "push":
                # For push events, we need the head SHA from the event
                head_sha = (event or {}).get("head_commit", {}).get("id") or (event or {}).get("after")
                if not head_sha:
                    return {"feedback": "skipped", "reason": "no head SHA in push event"}

                # If there are no IaC changes, post a passing check run
                if not changed_iac_paths:
                    posted = _post_check_run(
                        client, owner, repo, head_sha,
                        title="Vigil IaC Scan: No changes",
                        summary="No .tf/.hcl changes in this push",
                        text=f"No Terraform/HCL files changed in {ctx['repo']}@{ctx['branch'] or 'unknown'}.",
                        conclusion="success",
                    )
                    return {"feedback": posted["action"], "check_run_url": posted.get("check_run_url"), **posted}

                title, summary, text = _check_run_text(ctx["repo"], ctx["branch"] or "unknown", scan_result)
                conclusion = "success" if "no security issues" in title.lower() else "failure"
                posted = _post_check_run(client, owner, repo, head_sha, title, summary, text, conclusion)
                return {"feedback": posted["action"], "check_run_url": posted.get("check_run_url"), **posted}
            else:
                return {"feedback": "skipped", "reason": f"event '{event_type}' not handled for feedback"}
        except httpx.HTTPStatusError as e:
            return {
                "feedback": "error",
                "reason": f"GitHub API error: {e.response.status_code} — {e.response.text[:300]}",
            }
        except Exception as e:
            return {"feedback": "error", "reason": str(e)}
