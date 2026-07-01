/** Official reference URLs for compliance controls — mirrors api/app/services/control_reference_urls.py */

const SOC2_TSC_PDF =
  "https://assets.ctfassets.net/rb9cdnjh59cm/72xv4p67HVXKp6CjWmjkPk/" +
  "1cdbfa19f6307e2720396b66a6194dc9/trust-services-criteria-updated-copyright.pdf";

const ISO27002_OBP_BASE =
  "https://www.iso.org/obp/ui/en/#iso:std:iso-iec:27002:ed-2:v1:en:sec:";

const ISO_2013_ANNEX_A_TO_27002_2022: Record<string, [string, string]> = {
  "A.9.2.1": ["5.16", "Identity management"],
  "A.9.2.2": ["5.18", "Access rights"],
  "A.9.2.4": ["5.17", "Authentication information"],
  "A.9.2.5": ["5.18", "Access rights"],
  "A.9.4.2": ["8.5", "Secure authentication"],
  "A.10.1.1": ["8.24", "Use of cryptography"],
  "A.12.3.1": ["8.13", "Information backup"],
  "A.12.4.1": ["8.15", "Logging"],
  "A.12.4.2": ["8.16", "Monitoring activities"],
  "A.12.6.1": ["8.8", "Management of technical vulnerabilities"],
  "A.13.1.1": ["8.20", "Networks security"],
  "A.13.2.3": ["8.22", "Segregation of networks"],
  "A.17.2.1": ["5.30", "ICT readiness for business continuity"],
};

const CIS_L1_SECURITY_HUB: Record<string, [string, string, string]> = {
  "1.4": ["iam-4", "IAM.4", "Root access keys should not exist"],
  "1.5": ["iam-9", "IAM.9", "MFA enabled for root user"],
  "1.6": ["iam-6", "IAM.6", "Hardware MFA for root user"],
  "1.7": ["cloudwatch-1", "CloudWatch.1", "Alarm on root user activity"],
  "1.8": ["iam-15", "IAM.15", "Password policy minimum length"],
  "1.9": ["iam-5", "IAM.5", "MFA for IAM users with console password"],
  "1.10": ["iam-5", "IAM.5", "MFA for IAM users with console password"],
  "1.12": ["iam-8", "IAM.8", "Unused IAM credentials"],
  "1.14": ["iam-3", "IAM.3", "Access key rotation"],
  "1.16": ["iam-2", "IAM.2", "No IAM policies attached to users"],
  "1.19": ["iam-7", "IAM.7", "Eliminate shared access keys"],
  "1.22": ["iam-21", "IAM.21", "Wildcard customer managed policies"],
  "2.1": ["cloudtrail-1", "CloudTrail.1", "CloudTrail enabled"],
  "2.2": ["cloudtrail-4", "CloudTrail.4", "CloudTrail log file validation"],
  "2.3": ["cloudtrail-2", "CloudTrail.2", "CloudTrail encryption"],
  "3.1": ["cloudwatch-1", "CloudWatch.1", "Root usage metric filter"],
  "4.1": ["ec2-2", "EC2.2", "Default security group restricted"],
};

const CIS_SH_IAM =
  "https://docs.aws.amazon.com/securityhub/latest/userguide/iam-controls.html";
const CIS_SH_CLOUDTRAIL =
  "https://docs.aws.amazon.com/securityhub/latest/userguide/cloudtrail-controls.html";
const CIS_SH_CLOUDWATCH =
  "https://docs.aws.amazon.com/securityhub/latest/userguide/cloudwatch-controls.html";
const CIS_SH_EC2 =
  "https://docs.aws.amazon.com/securityhub/latest/userguide/ec2-controls.html";
const CIS_SH_STANDARDS =
  "https://docs.aws.amazon.com/securityhub/latest/userguide/securityhub-standards-cis.html";

function cisPageForAnchor(anchor: string): string {
  if (anchor.startsWith("iam-")) return CIS_SH_IAM;
  if (anchor.startsWith("cloudtrail-")) return CIS_SH_CLOUDTRAIL;
  if (anchor.startsWith("cloudwatch-")) return CIS_SH_CLOUDWATCH;
  if (anchor.startsWith("ec2-")) return CIS_SH_EC2;
  return CIS_SH_STANDARDS;
}

/** Return official documentation URL for a framework control ID. */
export function controlReferenceUrl(framework: string, controlId: string): string {
  if (framework === "cis_aws_l1") {
    const entry = CIS_L1_SECURITY_HUB[controlId.trim()];
    if (entry) {
      const [anchor] = entry;
      return `${cisPageForAnchor(anchor)}#${anchor}`;
    }
    return CIS_SH_STANDARDS;
  }

  if (framework === "soc2") {
    return SOC2_TSC_PDF;
  }

  if (framework === "iso27001") {
    const annexId = controlId.startsWith("A.") ? controlId : `A.${controlId}`;
    const mapped = ISO_2013_ANNEX_A_TO_27002_2022[annexId];
    if (mapped) {
      const [iso22Id] = mapped;
      return `${ISO27002_OBP_BASE}${iso22Id}`;
    }
    return `${ISO27002_OBP_BASE}5`;
  }

  return SOC2_TSC_PDF;
}
