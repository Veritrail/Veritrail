/**
 * Fixture assertions for resourceAffectedReason (Resources tab "why" column).
 * Run: npx --yes tsx scripts/assert-resource-affected-reason.mts
 */
import { resourceAffectedReason } from "../src/lib/resourceAffectedReason.ts";

const FIXTURES = [
  {
    check_id: "iam.role.least_privilege_policy",
    evidence: { sources: ["customer managed full admin: AdminAccessPolicy"] },
    expected: "Role has full administrator access — Customer-managed · AdminAccessPolicy",
  },
  {
    check_id: "iam.role.least_privilege_policy",
    evidence: { scope: "full_admin" },
    expected: "Role has full administrator access — Action:* · Resource:*",
  },
  {
    check_id: "iam.user.admin_policy_attached",
    evidence: { admin_policies: ["AdministratorAccess"] },
    expected: "User has full administrator access — Managed policy · AdministratorAccess",
  },
  {
    check_id: "ec2.security_group.unrestricted_ssh",
    evidence: {
      group_name: "web",
      exposing_rules: [
        {
          protocol: "tcp",
          from_port: 22,
          to_port: 22,
          cidr: "0.0.0.0/0",
          match_reason: "port_in_range",
        },
      ],
    },
    expected: "Internet-exposed SSH — 0.0.0.0/0 · Port 22",
  },
  {
    check_id: "kms.key.policy_wildcard_principal",
    evidence: { alias: "alias/prod-secrets", key_id: "abc-123" },
    expected: "KMS key permits any principal — Principal:* · alias/prod-secrets",
  },
  {
    check_id: "iam.role.external_account_trust",
    evidence: { external_account_ids: ["111122223333", "444455556666"] },
    expected: "External AWS account can assume this role — Trusted · 111122223333, 444455556666",
  },
  {
    check_id: "iam.access_key.unused_90d",
    evidence: { days_unused: 120 },
    expected: "Unused access key remains active — No use · 120+ days",
  },
  {
    check_id: "iam.role.unused_services_90d",
    evidence: { unused_services: ["ec2", "logs", "ecr", "ec2messages", "imagebuilder"] },
    expected:
      "Role retains unused service access — Amazon EC2, CloudWatch Logs, Amazon ECR, EC2 Messages (+1 more) · 90 days",
  },
  {
    check_id: "iam.role.unused_services_90d",
    evidence: { unused_services: ["imagebuilder"] },
    expected: "Role retains unused service access — EC2 Image Builder · 90 days",
  },
  {
    check_id: "s3.bucket.no_kms",
    evidence: {},
    expected: "Bucket lacks KMS-backed encryption — No customer-controlled key protection",
  },
] as const;

let failed = 0;
for (const case_ of FIXTURES) {
  const got = resourceAffectedReason({
    check_id: case_.check_id,
    evidence: case_.evidence as Record<string, unknown>,
  });
  if (got !== case_.expected) {
    console.error(`${case_.check_id}: got ${JSON.stringify(got)}, want ${JSON.stringify(case_.expected)}`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`${failed} fixture(s) failed`);
  process.exit(1);
}
console.log(`ok — ${FIXTURES.length} resourceAffectedReason fixtures`);
