"""Regression: SSM Automation aws:executeScript Handler must be file.function when using attachments."""

import hashlib
import re
from pathlib import Path

_HANDLER_RE = re.compile(
    r"action:\s*aws:executeScript\s+.*?Handler:\s*(\S+)\s+.*?Attachment:\s*(\S+\.py)",
    re.DOTALL,
)

_CFN_NAME = "vigil-remediation-ssm.yaml"
_SCRIPT_CHECKSUM_MAP = {
    "RevokeSgIngress": "revoke_sg_ingress.py",
    "DeactivateAccessKey": "deactivate_access_key.py",
    "MigrateSecureString": "migrate_to_secure_string.py",
    "RemediateExcessPermissions": "remediate_excess_permissions.py",
}
_CHECKSUM_RE = re.compile(
    r"^\s{4}(\w+):\n\s+sha256:\s+([a-f0-9]{64})$",
    re.MULTILINE,
)


def _remediation_cfn_path() -> Path:
    """Resolve CFN template from repo checkout or compose infra mount."""
    local = Path(__file__).resolve().parents[2] / "infra" / "cfn" / _CFN_NAME
    if local.is_file():
        return local
    docker = Path("/infra/cfn") / _CFN_NAME
    if docker.is_file():
        return docker
    raise FileNotFoundError(_CFN_NAME)


def _scripts_dir() -> Path:
    return _remediation_cfn_path().parent / "ssm-scripts"


def test_ssm_script_checksums_match_repo_files():
    text = _remediation_cfn_path().read_text()
    block = text.split("Mappings:", 1)[1].split("Resources:", 1)[0]
    declared = dict(_CHECKSUM_RE.findall(block))
    assert set(declared) == set(_SCRIPT_CHECKSUM_MAP)
    for map_key, script_name in _SCRIPT_CHECKSUM_MAP.items():
        script_path = _scripts_dir() / script_name
        assert script_path.is_file(), f"missing handler script {script_name}"
        digest = hashlib.sha256(script_path.read_bytes()).hexdigest()
        assert declared[map_key] == digest, (
            f"SsmScriptChecksums.{map_key} must match sha256 of {script_name}"
        )


def test_execute_script_handlers_match_attachment_basenames():
    text = _remediation_cfn_path().read_text()
    pairs = _HANDLER_RE.findall(text)
    assert pairs, "expected aws:executeScript Handler/Attachment pairs in vigil-remediation-ssm.yaml"
    for handler, attachment in pairs:
        module = attachment.removesuffix(".py")
        assert handler == f"{module}.handler", (
            f"Handler must be {module}.handler when Attachment is {attachment}, got {handler!r}"
        )
