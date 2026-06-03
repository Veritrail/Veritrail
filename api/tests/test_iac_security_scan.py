"""Tests for the native deterministic Terraform/Terragrunt security lint."""
from __future__ import annotations

from app.services.iac_security_scan import (
    SEV_HIGH,
    SEV_MEDIUM,
    scan_terraform_files,
    summarize,
)


def _scan(content: str, path: str = "main.tf"):
    return scan_terraform_files([{"path": path, "content": content}])


def _ids(findings):
    return {f.rule_id for f in findings}


def test_clean_terraform_yields_no_findings():
    tf = '''
resource "aws_iam_policy" "scoped" {
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject"]
      Resource = ["arn:aws:s3:::my-bucket/*"]
    }]
  })
}

resource "aws_db_instance" "ok" {
  publicly_accessible = false
  storage_encrypted   = true
}
'''
    assert scan_terraform_files([{"path": "main.tf", "content": tf}]) == []


def test_iam_full_wildcard_action_json_is_high():
    tf = '''
resource "aws_iam_policy" "admin" {
  policy = jsonencode({
    Statement = [{ Effect = "Allow", Action = "*", Resource = "arn:aws:s3:::b/*" }]
  })
}
'''
    findings = _scan(tf)
    f = next(x for x in findings if x.rule_id == "iac.iam.wildcard_action")
    assert f.severity == SEV_HIGH
    assert f.resource_type == "aws_iam_policy"
    assert f.line >= 1


def test_iam_service_wildcard_action_is_medium_not_high():
    tf = '''
resource "aws_iam_role_policy" "svc" {
  policy = jsonencode({
    Statement = [{ Effect = "Allow", Action = "s3:*", Resource = "arn:aws:s3:::b/*" }]
  })
}
'''
    findings = _scan(tf)
    assert "iac.iam.wildcard_service_action" in _ids(findings)
    assert "iac.iam.wildcard_action" not in _ids(findings)
    f = next(x for x in findings if x.rule_id == "iac.iam.wildcard_service_action")
    assert f.severity == SEV_MEDIUM


def test_iam_wildcard_action_hcl_policy_document_form():
    tf = '''
data "aws_iam_policy_document" "broad" {
  statement {
    actions   = ["*"]
    resources = ["*"]
  }
}
'''
    findings = _scan(tf)
    assert "iac.iam.wildcard_action" in _ids(findings)
    # Resource "*" without PassRole => medium wildcard_resource
    assert "iac.iam.wildcard_resource" in _ids(findings)


def test_passrole_with_wildcard_resource_is_escalation_high():
    tf = '''
resource "aws_iam_policy" "passrole" {
  policy = jsonencode({
    Statement = [{ Effect = "Allow", Action = "iam:PassRole", Resource = "*" }]
  })
}
'''
    findings = _scan(tf)
    f = next(x for x in findings if x.rule_id == "iac.iam.passrole_wildcard_resource")
    assert f.severity == SEV_HIGH
    assert "iac.iam.wildcard_resource" not in _ids(findings)  # specialized rule wins


def test_plain_wildcard_resource_without_passrole_is_medium():
    tf = '''
resource "aws_iam_policy" "broadres" {
  policy = jsonencode({
    Statement = [{ Effect = "Allow", Action = "s3:GetObject", Resource = "*" }]
  })
}
'''
    findings = _scan(tf)
    f = next(x for x in findings if x.rule_id == "iac.iam.wildcard_resource")
    assert f.severity == SEV_MEDIUM


def test_wildcard_outside_iam_policy_context_is_ignored():
    # A wildcard string in a non-IAM resource (e.g. an output / tag) must not false-positive.
    tf = '''
resource "aws_s3_bucket" "logs" {
  bucket = "logs"
  tags   = { Note = "Action: * placeholder" }
}
'''
    assert "iac.iam.wildcard_action" not in _ids(_scan(tf))


def test_security_group_open_ssh_is_high():
    tf = '''
resource "aws_security_group" "ssh" {
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
'''
    f = next(x for x in _scan(tf) if x.rule_id == "iac.sg.open_ingress")
    assert f.severity == SEV_HIGH


def test_security_group_open_high_port_not_flagged():
    # 0.0.0.0/0 to a non-sensitive port (443) is not flagged by this rule.
    tf = '''
resource "aws_security_group" "web" {
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
'''
    assert "iac.sg.open_ingress" not in _ids(_scan(tf))


def test_rds_public_and_unencrypted():
    tf = '''
resource "aws_db_instance" "db" {
  publicly_accessible = true
  storage_encrypted   = false
}
'''
    ids = _ids(_scan(tf))
    assert "iac.rds.public" in ids
    assert "iac.rds.unencrypted" in ids


def test_ebs_unencrypted_and_s3_public_acl_and_pab_disabled():
    tf = '''
resource "aws_ebs_volume" "v" {
  encrypted = false
}
resource "aws_s3_bucket" "pub" {
  acl = "public-read"
}
resource "aws_s3_bucket_public_access_block" "weak" {
  block_public_acls = false
}
'''
    ids = _ids(_scan(tf))
    assert {"iac.ebs.unencrypted", "iac.s3.public_acl", "iac.s3.pab_disabled"} <= ids


def test_summarize_counts_and_sort_high_first():
    tf = '''
resource "aws_iam_policy" "admin" {
  policy = jsonencode({ Statement = [{ Effect = "Allow", Action = "*", Resource = "*" }] })
}
resource "aws_ebs_volume" "v" { encrypted = false }
'''
    findings = scan_terraform_files([{"path": "main.tf", "content": tf}])
    summary = summarize(findings)
    assert summary["total"] == len(findings) >= 2
    assert summary["highest_severity"] == SEV_HIGH
    assert summary["by_severity"][SEV_HIGH] >= 1
    assert summary["by_severity"][SEV_MEDIUM] >= 1
    # sorted: first finding is the highest severity
    assert findings[0].severity == SEV_HIGH
    assert summary["findings"][0]["severity"] == SEV_HIGH
