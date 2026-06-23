"""Run terraform fmt + validate on patched file set."""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.config import get_settings


def terraform_fmt_validate(files: list[dict[str, str]]) -> dict:
    settings = get_settings()
    if settings.TERRAFORM_VALIDATE_SKIP:
        return {"ok": True, "skipped": True}
    if not shutil.which("terraform"):
        return {"ok": False, "error": "terraform CLI not installed on API host"}

    with tempfile.TemporaryDirectory(prefix="veritrail-tf-") as td:
        root = Path(td).resolve()
        for f in files:
            rel = (f.get("path") or "main.tf").lstrip("/")
            if ".." in Path(rel).parts:
                return {"ok": False, "error": f"invalid terraform path: {rel}"}
            p = (root / rel).resolve()
            if not p.is_relative_to(root):
                return {"ok": False, "error": f"invalid terraform path: {rel}"}
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(f.get("content") or "", encoding="utf-8")

        fmt = subprocess.run(
            ["terraform", "fmt", "-recursive"],
            cwd=td,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if fmt.returncode != 0:
            return {"ok": False, "step": "fmt", "error": fmt.stderr or fmt.stdout}

        init = subprocess.run(
            ["terraform", "init", "-backend=false", "-input=false"],
            cwd=td,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if init.returncode != 0:
            return {"ok": False, "step": "init", "error": init.stderr or init.stdout}

        val = subprocess.run(
            ["terraform", "validate", "-no-color"],
            cwd=td,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if val.returncode != 0:
            return {"ok": False, "step": "validate", "error": val.stderr or val.stdout}

    return {"ok": True}
