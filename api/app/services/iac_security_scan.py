"""Native deterministic Terraform/Terragrunt security lint.

No external binaries, no LLM — hand-verifiable regex/text rules over HCL, mirroring the repo's
existing deterministic IaC parser (``terraform_iac.py``). This native ruleset is **always on**.
Optional Checkov/tfsec augmentation lives in ``iac_external_scan.py`` behind a flag and only
*adds* findings; it never replaces this engine.

Grounded in deepsearch v5 §"IAM Policy Generation Accuracy" + §"Terraform/Terragrunt & Automation
Integration": minimize IAM wildcards, fail when a new ``*`` is introduced, and surface
least-privilege / public-exposure issues before merge. Every rule is deterministic and
hand-verifiable (no scoring magic) per the project style guide.

Read-only boundary: this lints *source code text only*. It never calls AWS and never modifies
any repo or resource. The PR hook posts findings; humans decide.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

SEV_HIGH = "high"
SEV_MEDIUM = "medium"
SEV_LOW = "low"

_SEVERITY_RANK = {SEV_HIGH: 0, SEV_MEDIUM: 1, SEV_LOW: 2}


@dataclass
class IacFinding:
    """One deterministic IaC lint result. ``engine`` distinguishes native vs external (checkov/tfsec)."""

    rule_id: str
    severity: str
    title: str
    detail: str
    remediation: str
    resource_type: str
    resource_name: str
    file_path: str
    line: int
    refs: list[str] = field(default_factory=list)
    engine: str = "native"

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class _Block:
    kind: str  # "resource" | "data"
    type: str
    name: str
    body: str
    file_path: str
    line: int


# ── HCL block parsing (resource + data heads; brace-matched body) ───────────────────────────
_BLOCK_HEAD = re.compile(r'(resource|data)\s+"([^"]+)"\s+"([^"]+)"\s*\{')


def _extract_brace_block(text: str, open_idx: int) -> str:
    depth = 0
    for i in range(open_idx, len(text)):
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[open_idx : i + 1]
    return text[open_idx:]


def _iter_blocks(files: list[dict[str, str]]):
    for f in files:
        path = f.get("path") or "main.tf"
        content = f.get("content") or ""
        for m in _BLOCK_HEAD.finditer(content):
            kind, rtype, rname = m.group(1), m.group(2), m.group(3)
            body = _extract_brace_block(content, m.end() - 1)
            line = content.count("\n", 0, m.start()) + 1
            yield _Block(kind=kind, type=rtype, name=rname, body=body, file_path=path, line=line)


# ── IAM wildcard detection (JSON policy docs *and* aws_iam_policy_document HCL) ──────────────
_IAM_POLICY_TYPES = {
    "aws_iam_policy",
    "aws_iam_role_policy",
    "aws_iam_user_policy",
    "aws_iam_group_policy",
    "aws_iam_policy_document",
}

# Match Action/Resource wildcards across all three real-world HCL/JSON forms:
#   JSON policy (heredoc / file):   "Action": "*"        "Resource": ["a", "*"]
#   jsonencode({...}) HCL map:      Action  = "*"        Resource = ["*"]
#   aws_iam_policy_document block:  actions = ["*"]      resources = ["*"]
# Key alternation lists the quoted JSON token first, then the bare HCL identifiers (capitalized
# jsonencode key + lowercase policy_document key). \b guards stop NotAction/NotResource matching.
_ACTION_KEY = r'(?:"Action"|\bAction\b|\bactions\b)'
_RESOURCE_KEY = r'(?:"Resource"|\bResource\b|\bresources\b)'
_SEP = r'\s*[:=]\s*'
_LIST_PREFIX = r'(?:\[[^\]]*)?'

_ACTION_STAR = re.compile(_ACTION_KEY + _SEP + _LIST_PREFIX + r'"\*"')
_ACTION_SVC_STAR = re.compile(_ACTION_KEY + _SEP + _LIST_PREFIX + r'"[a-zA-Z0-9]+:\*"')
_RESOURCE_STAR = re.compile(_RESOURCE_KEY + _SEP + _LIST_PREFIX + r'"\*"')
_PASSROLE = re.compile(r'(?:iam:)?PassRole', re.IGNORECASE)
_HAS_POLICY_DOC = re.compile(r'("Statement"|statement\s*\{|jsonencode\s*\()')


def _is_iam_policy_block(b: _Block) -> bool:
    if b.type in _IAM_POLICY_TYPES:
        return True
    # inline policy on an IAM principal resource carrying an actual policy document
    return b.type.startswith("aws_iam_") and bool(_HAS_POLICY_DOC.search(b.body))


def _rule_iam_wildcard_action(b: _Block) -> IacFinding | None:
    if not _is_iam_policy_block(b):
        return None
    if _ACTION_STAR.search(b.body):
        return IacFinding(
            rule_id="iac.iam.wildcard_action",
            severity=SEV_HIGH,
            title="IAM policy grants all actions (Action: \"*\")",
            detail=(
                f'{b.type}.{b.name} grants Action "*" — every action on AWS. A full action wildcard '
                "is the broadest grant possible and almost never required."
            ),
            remediation=(
                "Replace \"*\" with the exact actions the principal uses. Run Vigil's least-privilege "
                "generator (Last Accessed + IAM Access Analyzer) to derive the real action set, then "
                "scope to specific resource ARNs."
            ),
            resource_type=b.type,
            resource_name=b.name,
            file_path=b.file_path,
            line=b.line,
            refs=["CIS AWS 1.16", "AWS IAM: grant least privilege"],
        )
    if _ACTION_SVC_STAR.search(b.body):
        return IacFinding(
            rule_id="iac.iam.wildcard_service_action",
            severity=SEV_MEDIUM,
            title="IAM policy grants all actions for a service (service:*)",
            detail=(
                f"{b.type}.{b.name} grants a service-level wildcard (e.g. s3:*). This is broader than "
                "the principal's recorded usage in most cases."
            ),
            remediation=(
                "Narrow service:* to the specific operations in use. Use Vigil's least-privilege "
                "generator to list the actions actually called, then enumerate them explicitly."
            ),
            resource_type=b.type,
            resource_name=b.name,
            file_path=b.file_path,
            line=b.line,
            refs=["AWS IAM: avoid service wildcards"],
        )
    return None


def _rule_iam_wildcard_resource(b: _Block) -> IacFinding | None:
    if not _is_iam_policy_block(b):
        return None
    if not _RESOURCE_STAR.search(b.body):
        return None
    passrole = bool(_PASSROLE.search(b.body))
    return IacFinding(
        rule_id="iac.iam.passrole_wildcard_resource" if passrole else "iac.iam.wildcard_resource",
        severity=SEV_HIGH if passrole else SEV_MEDIUM,
        title=(
            "iam:PassRole on all resources (Resource: \"*\")"
            if passrole
            else "IAM policy applies to all resources (Resource: \"*\")"
        ),
        detail=(
            f"{b.type}.{b.name} uses Resource \"*\""
            + (
                " together with iam:PassRole — a classic privilege-escalation path (pass any role to a "
                "service)."
                if passrole
                else " — actions apply to every resource of the relevant services."
            )
        ),
        remediation=(
            "Constrain Resource to specific ARNs. For iam:PassRole, list only the exact role ARNs the "
            "workload must pass. Vigil's generator emits resource-scoped ARNs when Access Analyzer "
            "CloudTrail data is available."
        ),
        resource_type=b.type,
        resource_name=b.name,
        file_path=b.file_path,
        line=b.line,
        refs=["CIS AWS 1.16", "AWS IAM: PassRole least privilege"],
    )


# ── Public-exposure / encryption misconfig rules ────────────────────────────────────────────
_SG_SENSITIVE = re.compile(r'(?:from_port\s*=\s*(?:22|3389|0)\b|protocol\s*=\s*"-1")')
_OPEN_CIDR = re.compile(r'(?:0\.0\.0\.0/0|::/0)')


def _rule_sg_open_ingress(b: _Block) -> IacFinding | None:
    if b.type not in ("aws_security_group", "aws_security_group_rule"):
        return None
    if not _OPEN_CIDR.search(b.body) or not _SG_SENSITIVE.search(b.body):
        return None
    return IacFinding(
        rule_id="iac.sg.open_ingress",
        severity=SEV_HIGH,
        title="Security group opens a sensitive port to the internet",
        detail=(
            f"{b.type}.{b.name} allows 0.0.0.0/0 (or ::/0) to a sensitive port (22/3389) or all "
            "protocols. This exposes admin access to the public internet."
        ),
        remediation=(
            "Restrict the ingress CIDR to known office/VPN ranges or a bastion security group. Never "
            "expose SSH (22) / RDP (3389) to 0.0.0.0/0."
        ),
        resource_type=b.type,
        resource_name=b.name,
        file_path=b.file_path,
        line=b.line,
        refs=["CIS AWS 5.2", "CIS AWS 5.3"],
    )


def _rule_rds_public(b: _Block) -> IacFinding | None:
    if b.type not in ("aws_db_instance", "aws_rds_cluster_instance"):
        return None
    if not re.search(r'publicly_accessible\s*=\s*true', b.body):
        return None
    return IacFinding(
        rule_id="iac.rds.public",
        severity=SEV_HIGH,
        title="RDS instance is publicly accessible",
        detail=f"{b.type}.{b.name} sets publicly_accessible = true, giving it a public endpoint.",
        remediation="Set publicly_accessible = false and reach the database through private subnets / a VPN.",
        resource_type=b.type,
        resource_name=b.name,
        file_path=b.file_path,
        line=b.line,
        refs=["AWS RDS: do not make DB instances public"],
    )


def _rule_rds_unencrypted(b: _Block) -> IacFinding | None:
    if b.type not in ("aws_db_instance", "aws_rds_cluster"):
        return None
    if not re.search(r'storage_encrypted\s*=\s*false', b.body):
        return None
    return IacFinding(
        rule_id="iac.rds.unencrypted",
        severity=SEV_MEDIUM,
        title="RDS storage is not encrypted at rest",
        detail=f"{b.type}.{b.name} sets storage_encrypted = false.",
        remediation="Set storage_encrypted = true (and supply a kms_key_id for CMK control).",
        resource_type=b.type,
        resource_name=b.name,
        file_path=b.file_path,
        line=b.line,
        refs=["CIS AWS 2.3.1"],
    )


def _rule_ebs_unencrypted(b: _Block) -> IacFinding | None:
    if b.type != "aws_ebs_volume":
        return None
    if not re.search(r'\bencrypted\s*=\s*false', b.body):
        return None
    return IacFinding(
        rule_id="iac.ebs.unencrypted",
        severity=SEV_MEDIUM,
        title="EBS volume is not encrypted at rest",
        detail=f"{b.type}.{b.name} sets encrypted = false.",
        remediation="Set encrypted = true (enable EBS encryption by default at the account level too).",
        resource_type=b.type,
        resource_name=b.name,
        file_path=b.file_path,
        line=b.line,
        refs=["CIS AWS 2.2.1"],
    )


def _rule_s3_public_acl(b: _Block) -> IacFinding | None:
    if b.type not in ("aws_s3_bucket", "aws_s3_bucket_acl"):
        return None
    if not re.search(r'\bacl\s*=\s*"(public-read|public-read-write)"', b.body):
        return None
    return IacFinding(
        rule_id="iac.s3.public_acl",
        severity=SEV_HIGH,
        title="S3 bucket has a public ACL",
        detail=f"{b.type}.{b.name} uses a public-read / public-read-write ACL.",
        remediation=(
            "Remove the public ACL and add an aws_s3_bucket_public_access_block with all four block_* "
            "flags set to true."
        ),
        resource_type=b.type,
        resource_name=b.name,
        file_path=b.file_path,
        line=b.line,
        refs=["CIS AWS 2.1.5"],
    )


def _rule_s3_pab_disabled(b: _Block) -> IacFinding | None:
    if b.type != "aws_s3_bucket_public_access_block":
        return None
    if not re.search(
        r'(block_public_acls|block_public_policy|ignore_public_acls|restrict_public_buckets)\s*=\s*false',
        b.body,
    ):
        return None
    return IacFinding(
        rule_id="iac.s3.pab_disabled",
        severity=SEV_HIGH,
        title="S3 public access block has a disabled flag",
        detail=(
            f"{b.type}.{b.name} sets one or more block_* flags to false, partially disabling public-access "
            "protection."
        ),
        remediation="Set block_public_acls, block_public_policy, ignore_public_acls and restrict_public_buckets all to true.",
        resource_type=b.type,
        resource_name=b.name,
        file_path=b.file_path,
        line=b.line,
        refs=["CIS AWS 2.1.5"],
    )


_RULES = [
    _rule_iam_wildcard_action,
    _rule_iam_wildcard_resource,
    _rule_sg_open_ingress,
    _rule_rds_public,
    _rule_rds_unencrypted,
    _rule_ebs_unencrypted,
    _rule_s3_public_acl,
    _rule_s3_pab_disabled,
]


def sort_findings(findings: list[IacFinding]) -> list[IacFinding]:
    """In-place sort: highest severity first, then file path, then line. Shared by native + merged."""
    findings.sort(key=lambda f: (_SEVERITY_RANK.get(f.severity, 9), f.file_path, f.line))
    return findings


def scan_terraform_files(files: list[dict[str, str]]) -> list[IacFinding]:
    """Run every native rule over the supplied .tf/.hcl files; return findings sorted by severity."""
    findings: list[IacFinding] = []
    for b in _iter_blocks(files):
        for rule in _RULES:
            r = rule(b)
            if r is not None:
                findings.append(r)
    return sort_findings(findings)


def summarize(findings: list[IacFinding]) -> dict:
    """Compact rollup for the PR hook / API: counts by severity + the highest severity present."""
    counts = {SEV_HIGH: 0, SEV_MEDIUM: 0, SEV_LOW: 0}
    for f in findings:
        counts[f.severity] = counts.get(f.severity, 0) + 1
    return {
        "total": len(findings),
        "by_severity": counts,
        "highest_severity": findings[0].severity if findings else None,
        "findings": [f.to_dict() for f in findings],
    }
