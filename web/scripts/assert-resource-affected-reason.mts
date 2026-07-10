/**
 * Fixture assertions for resourceAffectedReason (Resources tab "why" column).
 * Run: npx --yes tsx scripts/assert-resource-affected-reason.mts
 */
import { resourceAffectedReason } from "../src/lib/resourceAffectedReason.ts";

const FIXTURES = [
  {
    check_id: "iam.role.least_privilege_policy",
    evidence: { sources: ["customer managed full admin: AdminAccessPolicy"] },
    expected: "Granted via customer managed full admin: AdminAccessPolicy.",
  },
  {
    check_id: "iam.role.least_privilege_policy",
    evidence: { scope: "full_admin" },
    expected: "Grants full admin (Action:* + Resource:*).",
  },
  {
    check_id: "iam.user.admin_policy_attached",
    evidence: { admin_policies: ["AdministratorAccess"] },
    expected: "Admin policy attached: AdministratorAccess.",
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
    expected: "Allows 0.0.0.0/0 on port 22.",
  },
  {
    check_id: "kms.key.policy_wildcard_principal",
    evidence: { alias: "alias/prod-secrets", key_id: "abc-123" },
    expected: "Key policy for alias/prod-secrets allows principal *.",
  },
  {
    check_id: "iam.role.external_account_trust",
    evidence: { external_account_ids: ["111122223333", "444455556666"] },
    expected: "Trusts external AWS account 111122223333, 444455556666.",
  },
  {
    check_id: "iam.access_key.unused_90d",
    evidence: { days_unused: 120 },
    expected: "No use recorded in 120+ days.",
  },
  {
    check_id: "s3.bucket.no_kms",
    evidence: {},
    expected: "Objects are stored without SSE KMS at rest.",
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
