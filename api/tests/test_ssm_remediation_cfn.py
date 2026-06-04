"""Regression: SSM Automation aws:executeScript Handler must be file.function when using attachments."""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
REMEDIATION_CFN = REPO_ROOT / "infra" / "cfn" / "vigil-remediation-ssm.yaml"

_HANDLER_RE = re.compile(
    r"action:\s*aws:executeScript\s+.*?Handler:\s*(\S+)\s+.*?Attachment:\s*(\S+\.py)",
    re.DOTALL,
)


def test_execute_script_handlers_match_attachment_basenames():
    text = REMEDIATION_CFN.read_text()
    pairs = _HANDLER_RE.findall(text)
    assert pairs, "expected aws:executeScript Handler/Attachment pairs in vigil-remediation-ssm.yaml"
    for handler, attachment in pairs:
        module = attachment.removesuffix(".py")
        assert handler == f"{module}.handler", (
            f"Handler must be {module}.handler when Attachment is {attachment}, got {handler!r}"
        )
