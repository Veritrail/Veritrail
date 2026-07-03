"""Invoke Go hclpatch binary for repo-aware Terraform matching."""
from __future__ import annotations

import json
import subprocess
from typing import Any

from app.core.config import get_settings


def _run_hclpatch(cmd: str, payload: dict[str, Any]) -> dict[str, Any]:
    bin_path = get_settings().HCLPATCH_BIN
    try:
        proc = subprocess.run(
            [bin_path, cmd],
            input=json.dumps(payload).encode(),
            capture_output=True,
            timeout=60,
            check=False,
        )
    except FileNotFoundError:
        return {"status": "error", "message": "hclpatch binary not installed"}
    if proc.returncode != 0:
        err = proc.stderr.decode() or proc.stdout.decode() or "hclpatch failed"
        return {"status": "error", "message": err.strip()}
    return json.loads(proc.stdout.decode())


def hcl_validate_syntax(files: list[dict[str, str]]) -> dict[str, Any]:
    """Validate HCL syntax using hclpatch validate-syntax.

    Returns {"ok": true} on success, or {"ok": false, "error": "..."} with a
    per-file error message when syntax errors are found.
    """
    return _run_hclpatch("validate-syntax", {"files": files})


def hcl_detect_layout(
    files: list[dict[str, str]],
    *,
    uses_terragrunt: bool = False,
) -> dict[str, Any]:
    """Infer Terraform/Terragrunt subdirectory layout from fetched repo files."""
    return _run_hclpatch(
        "detect-layout",
        {"uses_terragrunt": uses_terragrunt, "files": files},
    )


def hcl_repo_scan(
    *,
    check_id: str,
    files: list[dict[str, str]],
    bucket_name: str | None = None,
    key_id: str | None = None,
    group_id: str | None = None,
    group_name: str | None = None,
    # New fields for expanded check types
    instance_id: str | None = None,
    topic_name: str | None = None,
    queue_name: str | None = None,
    repo_name: str | None = None,
    vpc_id: str | None = None,
    function_name: str | None = None,
    lb_name: str | None = None,
) -> dict[str, Any]:
    req = {
        "check_id": check_id,
        "bucket_name": bucket_name,
        "key_id": key_id,
        "group_id": group_id,
        "group_name": group_name,
        "instance_id": instance_id,
        "topic_name": topic_name,
        "queue_name": queue_name,
        "repo_name": repo_name,
        "vpc_id": vpc_id,
        "function_name": function_name,
        "lb_name": lb_name,
        "files": files,
    }
    return _run_hclpatch("scan", req)


def hcl_patch_preview(
    *,
    check_id: str,
    files: list[dict[str, str]],
    bucket_name: str | None = None,
    key_id: str | None = None,
    group_id: str | None = None,
    group_name: str | None = None,
    # New fields for expanded check types
    instance_id: str | None = None,
    topic_name: str | None = None,
    queue_name: str | None = None,
    repo_name: str | None = None,
    vpc_id: str | None = None,
    function_name: str | None = None,
    lb_name: str | None = None,
) -> dict[str, Any]:
    req = {
        "check_id": check_id,
        "bucket_name": bucket_name,
        "key_id": key_id,
        "group_id": group_id,
        "group_name": group_name,
        "instance_id": instance_id,
        "topic_name": topic_name,
        "queue_name": queue_name,
        "repo_name": repo_name,
        "vpc_id": vpc_id,
        "function_name": function_name,
        "lb_name": lb_name,
        "files": files,
    }
    out = _run_hclpatch("patch", req)
    if out.get("status") == "error" and "not installed" in (out.get("message") or ""):
        from app.services.terraform_iac import preview_terraform_patch

        return preview_terraform_patch(
            check_id=check_id,
            bucket_name=bucket_name,
            files=files,
        )
    return out
