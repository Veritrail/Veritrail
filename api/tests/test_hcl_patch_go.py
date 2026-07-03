import json
import shutil
import subprocess
from pathlib import Path

import pytest

HCLPATCH = Path(__file__).resolve().parents[2] / "tools" / "hclpatch"
BIN = shutil.which("hclpatch")


def _build_hclpatch() -> str:
    if BIN:
        return BIN
    out = HCLPATCH / "hclpatch"
    if not out.exists():
        subprocess.run(["go", "build", "-o", str(out), "."], cwd=HCLPATCH, check=True, timeout=60)
    return str(out)


@pytest.mark.skipif(shutil.which("go") is None, reason="go not installed")
def test_hclpatch_finds_s3_bucket():
    bin_path = _build_hclpatch()
    req = {
        "check_id": "s3.bucket.public_access_not_blocked",
        "bucket_name": "my-app-data",
        "files": [
            {
                "path": "s3.tf",
                "content": 'resource "aws_s3_bucket" "app" {\n  bucket = "my-app-data"\n}\n',
            }
        ],
    }
    proc = subprocess.run(
        [bin_path, "patch"],
        input=json.dumps(req).encode(),
        capture_output=True,
        timeout=15,
    )
    assert proc.returncode == 0, proc.stderr.decode()
    out = json.loads(proc.stdout)
    assert out["status"] in ("create_new", "modify_existing")
    assert "aws_s3_bucket_public_access_block" in (out.get("suggested_hcl") or "")


@pytest.mark.skipif(shutil.which("go") is None, reason="go not installed")
def test_hclpatch_detect_layout_terraform_and_terragrunt():
    bin_path = _build_hclpatch()
    req = {
        "uses_terragrunt": True,
        "files": [
            {
                "path": "terraform/s3-public/main.tf",
                "content": 'resource "aws_s3_bucket" "demo" {\n  bucket = "demo"\n}\n',
            },
            {
                "path": "terragrunt/live/prod/s3/terragrunt.hcl",
                "content": 'include "root" {\n  path = find_in_parent_folders()\n}\n',
            },
        ],
    }
    proc = subprocess.run(
        [bin_path, "detect-layout"],
        input=json.dumps(req).encode(),
        capture_output=True,
        timeout=15,
    )
    assert proc.returncode == 0, proc.stderr.decode()
    out = json.loads(proc.stdout)
    assert out["terraform_path"] == "terraform"
    assert out["terragrunt_path"] == "live"
    assert out["paths_differ"] is True


@pytest.mark.skipif(shutil.which("go") is None, reason="go not installed")
def test_hclpatch_detect_layout_root_terraform():
    bin_path = _build_hclpatch()
    req = {
        "uses_terragrunt": False,
        "files": [
            {
                "path": "main.tf",
                "content": 'resource "aws_s3_bucket" "demo" {\n  bucket = "demo"\n}\n',
            },
        ],
    }
    proc = subprocess.run(
        [bin_path, "detect-layout"],
        input=json.dumps(req).encode(),
        capture_output=True,
        timeout=15,
    )
    assert proc.returncode == 0, proc.stderr.decode()
    out = json.loads(proc.stdout)
    assert out["terraform_path"] == "."
    assert out["paths_differ"] is False
