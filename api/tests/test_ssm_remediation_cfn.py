"""Regression: SSM Automation aws:executeScript Handler must be file.function when using attachments."""

import re
from pathlib import Path

_HANDLER_RE = re.compile(
    r"action:\s*aws:executeScript\s+.*?Handler:\s*(\S+)\s+.*?Attachment:\s*(\S+\.py)",
    re.DOTALL,
)

_CFN_NAME = "vigil-remediation-ssm.yaml"


def _remediation_cfn_path() -> Path:
    """Resolve CFN template from repo checkout or compose infra mount."""
    local = Path(__file__).resolve().parents[2] / "infra" / "cfn" / _CFN_NAME
    if local.is_file():
        return local
    docker = Path("/infra/cfn") / _CFN_NAME
    if docker.is_file():
        return docker
    raise FileNotFoundError(_CFN_NAME)


def test_execute_script_handlers_match_attachment_basenames():
    text = _remediation_cfn_path().read_text()
    pairs = _HANDLER_RE.findall(text)
    assert pairs, "expected aws:executeScript Handler/Attachment pairs in vigil-remediation-ssm.yaml"
    for handler, attachment in pairs:
        module = attachment.removesuffix(".py")
        assert handler == f"{module}.handler", (
            f"Handler must be {module}.handler when Attachment is {attachment}, got {handler!r}"
        )
