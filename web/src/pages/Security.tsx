export default function Security() {
  return (
    <div className="min-h-screen bg-zinc-900 text-zinc-100">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="flex items-center gap-3 mb-12">
          <img src="/favicon.png" alt="Vigil" className="w-10 h-10 object-contain" />
          <span className="text-white text-lg font-semibold tracking-tight">Vigil</span>
        </div>

        <h1 className="text-3xl font-bold text-white mb-2">Security &amp; Permissions</h1>
        <p className="text-zinc-400 mb-10 text-sm">
          How Vigil accesses your AWS environment, what it reads, and how your data is protected.
        </p>

        <Section title="How access works">
          <p>
            Vigil uses a read-only IAM role in your AWS account — provisioned by a CloudFormation
            template you deploy. Vigil assumes this role via <code>sts:AssumeRole</code> using a
            unique External ID tied to your organization. No AWS credentials are ever stored;
            every scan uses short-lived STS session tokens that expire after 1 hour.
          </p>
          <p className="mt-3">
            To revoke access at any time, delete the CloudFormation stack in your AWS console.
            Vigil will lose access immediately — no action required on our side.
          </p>
        </Section>

        <Section title="AWS permissions requested">
          <p className="mb-4 text-zinc-400 text-sm">
            All permissions are read-only. Vigil never modifies, deletes, or creates any
            resource in your AWS account.
          </p>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-zinc-700">
                <th className="text-left py-2 pr-4 text-zinc-400 font-medium">Service</th>
                <th className="text-left py-2 text-zinc-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {PERMISSIONS.map(({ service, actions }) => (
                <tr key={service}>
                  <td className="py-2 pr-4 text-zinc-300 font-mono text-xs align-top whitespace-nowrap">{service}</td>
                  <td className="py-2 text-zinc-400 text-xs font-mono leading-relaxed">{actions.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="What is collected">
          <ul className="list-disc pl-5 space-y-1 text-zinc-400 text-sm">
            <li>IAM users, groups, roles, policies (metadata + policy documents — no secret values)</li>
            <li>S3 bucket configuration (encryption, versioning, public-access settings, bucket policies)</li>
            <li>KMS key metadata (rotation, state, aliases — no key material)</li>
            <li>CloudTrail trail configuration and logging state</li>
            <li>GuardDuty detector status per region</li>
            <li>VPC flow log configuration and security group rules</li>
            <li>EC2 instance metadata (type, state, IMDSv2 setting) and EBS volume encryption state</li>
            <li>RDS instance configuration (encryption, public accessibility, backup retention)</li>
            <li>IAM Access Analyzer, AWS Config, Security Hub enablement status</li>
            <li>GitHub/GitLab organization and repository metadata (MFA enforcement, branch protection rules, PR/MR review counts) — via separate OAuth integration, not AWS</li>
          </ul>
          <p className="mt-3 text-zinc-500 text-sm">
            No secrets, private keys, S3 object contents, database contents, or application
            data are ever accessed.
          </p>
        </Section>

        <Section title="Data storage and retention">
          <ul className="list-disc pl-5 space-y-1 text-zinc-400 text-sm">
            <li><strong className="text-zinc-300">Role ARN and External ID</strong> — encrypted at rest using Fernet (AES-128-CBC) with a key stored in the Vigil deployment environment, never in the database in plaintext.</li>
            <li><strong className="text-zinc-300">Scan results and findings</strong> — stored in a managed Postgres database. Retained for the duration of your subscription.</li>
            <li><strong className="text-zinc-300">Evidence snapshots</strong> — JSONB records of the raw API responses per entity per scan run. These are the artifacts provided in evidence packs for auditors.</li>
            <li><strong className="text-zinc-300">AWS credentials</strong> — never stored. Short-lived STS session tokens are held in memory only for the duration of a scan.</li>
          </ul>
        </Section>

        <Section title="Authentication">
          <ul className="list-disc pl-5 space-y-1 text-zinc-400 text-sm">
            <li>Passwords hashed with bcrypt (12 rounds) + SHA-256 pre-hash to handle inputs longer than bcrypt's 72-byte limit.</li>
            <li>Passwords checked against the Have I Been Pwned k-anonymity API at signup and change-password. Breached passwords are rejected at the UI.</li>
            <li>
              Access tokens: 24-hour signed JWTs (HS256). Refresh tokens: session-length (until you close the browser)
              or 30 days when you choose Remember me. Both invalidated on logout.
            </li>
            <li>Rate limiting: 10 login attempts per minute, 5 signup attempts per minute per IP.</li>
            <li>GitHub and Google OAuth supported — Vigil only reads your verified primary email address; no repo or calendar access.</li>
          </ul>
        </Section>

        <Section title="Network and infrastructure">
          <ul className="list-disc pl-5 space-y-1 text-zinc-400 text-sm">
            <li>All production traffic is served over HTTPS (TLS 1.2+).</li>
            <li>Vigil scans use read-only STS AssumeRole into your AWS account. Communication is only with AWS control-plane APIs (IAM, STS, S3, etc.) over public HTTPS — no VPN or VPC peering required.</li>
            <li>Database: Postgres 16, not publicly accessible, encrypted at rest.</li>
            <li>Nightly encrypted database backups to Backblaze B2.</li>
          </ul>
        </Section>

        <Section title="Contact">
          <p className="text-zinc-400 text-sm">
            Security questions or responsible disclosure: <a href="mailto:security@getvigil.io" className="text-sky-400 hover:text-sky-300">security@getvigil.io</a>
          </p>
        </Section>

        <p className="mt-12 text-xs text-zinc-600">Last updated: May 2026</p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-zinc-700">{title}</h2>
      <div className="text-zinc-300 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

const PERMISSIONS: { service: string; actions: string[] }[] = [
  { service: "iam", actions: ["GetAccountPasswordPolicy", "GetAccountSummary", "ListUsers", "ListUserTags", "GetLoginProfile", "ListMFADevices", "ListAccessKeys", "GetAccessKeyLastUsed", "ListRoles", "GetRole", "ListRolePolicies", "GetRolePolicy", "ListAttachedRolePolicies", "GetPolicy", "GetPolicyVersion", "ListPolicies", "ListPoliciesGrantingServiceAccess", "GenerateServiceLastAccessedDetails", "GetServiceLastAccessedDetails"] },
  { service: "s3", actions: ["ListAllMyBuckets", "GetBucketEncryption", "GetBucketVersioning", "GetBucketLogging", "GetBucketPublicAccessBlock", "GetBucketPolicy", "GetBucketAcl", "GetBucketLocation"] },
  { service: "s3control", actions: ["GetPublicAccessBlock"] },
  { service: "kms", actions: ["ListKeys", "DescribeKey", "GetKeyRotationStatus", "ListAliases"] },
  { service: "cloudtrail", actions: ["DescribeTrails", "GetTrailStatus", "LookupEvents"] },
  { service: "guardduty", actions: ["ListDetectors", "GetDetector"] },
  { service: "ec2", actions: ["DescribeRegions", "DescribeVpcs", "DescribeFlowLogs", "DescribeSecurityGroups", "DescribeInstances", "DescribeVolumes", "GetEbsEncryptionByDefault"] },
  { service: "rds", actions: ["DescribeDBInstances"] },
  { service: "access-analyzer", actions: ["ListAnalyzers"] },
  { service: "config", actions: ["DescribeConfigurationRecorders", "DescribeDeliveryChannels"] },
  { service: "securityhub", actions: ["DescribeHub"] },
  { service: "sts", actions: ["AssumeRole (used to establish the session only)"] },
];
