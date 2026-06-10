"""terraform_fmt_validate path safety."""
from unittest.mock import patch

from app.services.terraform_fmt_validate import terraform_fmt_validate


@patch("app.services.terraform_fmt_validate.get_settings")
def test_rejects_parent_path_segments(mock_settings):
    mock_settings.return_value.TERRAFORM_VALIDATE_SKIP = False

    with patch("app.services.terraform_fmt_validate.shutil.which", return_value="/usr/bin/terraform"):
        out = terraform_fmt_validate([{"path": "../escape.tf", "content": 'resource "null_resource" "x" {}'}])

    assert out["ok"] is False
    assert "invalid terraform path" in out["error"]


@patch("app.services.terraform_fmt_validate.get_settings")
def test_rejects_resolved_path_outside_temp_root(mock_settings):
    mock_settings.return_value.TERRAFORM_VALIDATE_SKIP = False

    with patch("app.services.terraform_fmt_validate.shutil.which", return_value="/usr/bin/terraform"):
        out = terraform_fmt_validate([{"path": "nested/../../outside.tf", "content": ""}])

    assert out["ok"] is False
    assert "invalid terraform path" in out["error"]
