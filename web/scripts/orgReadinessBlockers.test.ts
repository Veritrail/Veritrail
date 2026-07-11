/**
 * Lightweight assert tests for orgReadinessBlockers ranking.
 * Run: npx --yes tsx scripts/orgReadinessBlockers.test.ts
 */
import assert from "node:assert/strict";
import { groupBlockerFindings, unblockedControlIds, type BlockerFinding } from "../src/lib/orgReadinessBlockers";

const findings: BlockerFinding[] = [
  {
    id: "1",
    check_id: "iam.user.no_mfa",
    severity: "high",
    first_seen: "2026-07-10T00:00:00Z",
    resource_arn: "arn:aws:iam::123456789012:user/alice",
  },
  {
    id: "2",
    check_id: "iam.user.no_mfa",
    severity: "high",
    first_seen: "2026-07-08T00:00:00Z",
    resource_arn: "arn:aws:iam::123456789012:user/bob",
  },
  {
    id: "3",
    check_id: "cloudtrail.not_enabled",
    severity: "critical",
    first_seen: "2026-07-09T00:00:00Z",
    resource_arn: "arn:aws:cloudtrail:eu-west-1:123456789012:trail/default",
  },
];

const withoutStatus = groupBlockerFindings(findings, 3);
assert.ok(withoutStatus.length >= 1);
for (const g of withoutStatus) {
  assert.equal(g.failingControlIds.length, 0);
}
const cloudTrail = withoutStatus.find((group) => group.checkId === "cloudtrail.not_enabled");
assert.equal(cloudTrail?.severity, "critical");
assert.equal(cloudTrail?.location, "eu-west-1");
const iam = withoutStatus.find((group) => group.checkId === "iam.user.no_mfa");
assert.equal(iam?.firstSeen, "2026-07-08T00:00:00Z");

const statusMap: Record<string, string> = {};
for (const g of withoutStatus) {
  for (const id of g.soc2ControlIds) statusMap[id] = "pass";
}
const prefer = withoutStatus[withoutStatus.length - 1];
if (prefer && prefer.soc2ControlIds.length > 0) {
  for (const id of prefer.soc2ControlIds) statusMap[id] = "fail";
  const ranked = groupBlockerFindings(findings, 3, statusMap);
  assert.equal(ranked[0]?.checkId, prefer.checkId);
  assert.ok((ranked[0]?.failingControlIds.length ?? 0) > 0);
  const unblocked = unblockedControlIds(ranked);
  for (const id of ranked[0]!.failingControlIds) {
    assert.ok(unblocked.includes(id));
  }
}

console.log("orgReadinessBlockers.test.ts: ok");
