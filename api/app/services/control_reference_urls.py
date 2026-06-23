"""Official reference URLs for compliance controls (verified link targets)."""
from __future__ import annotations

# SOC 2 — AICPA Trust Services Criteria PDF (2017 TSC + 2022 points of focus).
SOC2_TSC_PDF = (
    "https://assets.ctfassets.net/rb9cdnjh59cm/72xv4p67HVXKp6CjWmjkPk/"
    "1cdbfa19f6307e2720396b66a6194dc9/trust-services-criteria-updated-copyright.pdf"
)
SOC2_OVERVIEW = (
    "https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2"
)

# ISO/IEC 27002:2022 — control text (Annex A in 27001:2013 maps here; 27001:2022 body clause 9 ≠ A.9.x).
ISO27002_OBP_BASE = "https://www.iso.org/obp/ui/en/#iso:std:iso-iec:27002:ed-2:v1:en:sec:"

# Veritrail ISO mappings use 27001:2013 Annex A IDs → 27002:2022 control numbers (ISO migration).
ISO_2013_ANNEX_A_TO_27002_2022: dict[str, tuple[str, str]] = {
    "A.9.2.1": ("5.16", "Identity management"),
    "A.9.2.2": ("5.18", "Access rights"),
    "A.9.2.4": ("5.17", "Authentication information"),
    "A.9.2.5": ("5.18", "Access rights"),
    "A.9.4.2": ("8.5", "Secure authentication"),
    "A.10.1.1": ("8.24", "Use of cryptography"),
    "A.12.3.1": ("8.13", "Information backup"),
    "A.12.4.1": ("8.15", "Logging"),
    "A.12.4.2": ("8.16", "Monitoring activities"),
    "A.12.6.1": ("8.8", "Management of technical vulnerabilities"),
    "A.13.1.1": ("8.20", "Networks security"),
    "A.13.2.3": ("8.22", "Segregation of networks"),
    "A.17.2.1": ("5.30", "ICT readiness for business continuity"),
}

# CIS AWS Foundations L1 (benchmark section) → Security Hub control doc anchor.
# AWS no longer publishes cis-1-5-automated anchors; CIS 1.5 = Security Hub [IAM.9].
CIS_L1_SECURITY_HUB: dict[str, tuple[str, str, str]] = {
    # cis_id: (sh_anchor_slug, sh_control_id, short_title)
    "1.4": ("iam-4", "IAM.4", "Root access keys should not exist"),
    "1.5": ("iam-9", "IAM.9", "MFA enabled for root user"),
    "1.6": ("iam-6", "IAM.6", "Hardware MFA for root user"),
    "1.7": ("cloudwatch-1", "CloudWatch.1", "Alarm on root user activity"),
    "1.8": ("iam-15", "IAM.15", "Password policy minimum length"),
    "1.9": ("iam-5", "IAM.5", "MFA for IAM users with console password"),
    "1.10": ("iam-5", "IAM.5", "MFA for IAM users with console password"),
    "1.12": ("iam-8", "IAM.8", "Unused IAM credentials"),
    "1.14": ("iam-3", "IAM.3", "Access key rotation"),
    "1.16": ("iam-2", "IAM.2", "No IAM policies attached to users"),
    "1.19": ("iam-7", "IAM.7", "Eliminate shared access keys"),
    "1.22": ("iam-21", "IAM.21", "Wildcard customer managed policies"),
    "2.1": ("cloudtrail-1", "CloudTrail.1", "CloudTrail enabled"),
    "2.2": ("cloudtrail-4", "CloudTrail.4", "CloudTrail log file validation"),
    "2.3": ("cloudtrail-2", "CloudTrail.2", "CloudTrail encryption"),
    "3.1": ("cloudwatch-1", "CloudWatch.1", "Root usage metric filter"),
    "4.1": ("ec2-2", "EC2.2", "Default security group restricted"),
}

CIS_SH_IAM = "https://docs.aws.amazon.com/securityhub/latest/userguide/iam-controls.html"
CIS_SH_CLOUDTRAIL = "https://docs.aws.amazon.com/securityhub/latest/userguide/cloudtrail-controls.html"
CIS_SH_CLOUDWATCH = "https://docs.aws.amazon.com/securityhub/latest/userguide/cloudwatch-controls.html"
CIS_SH_EC2 = "https://docs.aws.amazon.com/securityhub/latest/userguide/ec2-controls.html"
CIS_SH_STANDARDS = "https://docs.aws.amazon.com/securityhub/latest/userguide/securityhub-standards-cis.html"
CIS_OFFICIAL = "https://www.cisecurity.org/benchmark/amazon_web_services"


def _cis_page_for_anchor(anchor: str) -> str:
    if anchor.startswith("iam-"):
        return CIS_SH_IAM
    if anchor.startswith("cloudtrail-"):
        return CIS_SH_CLOUDTRAIL
    if anchor.startswith("cloudwatch-"):
        return CIS_SH_CLOUDWATCH
    if anchor.startswith("ec2-"):
        return CIS_SH_EC2
    return CIS_SH_STANDARDS


def reference_url(framework: str, control_id: str) -> tuple[str, str, str | None]:
    """Return (url, link_label, reference_note)."""
    if framework == "cis_aws_l1":
        entry = CIS_L1_SECURITY_HUB.get(control_id.strip())
        if entry:
            anchor, sh_id, _title = entry
            page = _cis_page_for_anchor(anchor)
            return (f"{page}#{anchor}", f"CIS AWS {control_id} (Security Hub {sh_id})", None)
        return (CIS_SH_STANDARDS, f"CIS AWS L1 {control_id}", None)

    if framework == "soc2":
        return (
            SOC2_TSC_PDF,
            f"SOC 2 {control_id} — Trust Services Criteria (PDF, AICPA)",
            None,
        )

    if framework == "iso27001":
        annex_id = control_id if control_id.startswith("A.") else f"A.{control_id}"
        mapped = ISO_2013_ANNEX_A_TO_27002_2022.get(annex_id)
        if mapped:
            iso22_id, iso22_title = mapped
            return (
                f"{ISO27002_OBP_BASE}{iso22_id}",
                f"ISO 27001 {annex_id} (27002 control {iso22_id}, {iso22_title.lower()})",
                None,
            )
        return (f"{ISO27002_OBP_BASE}5", f"ISO 27001 {annex_id}", None)

    return (SOC2_OVERVIEW, "Compliance framework reference", None)
