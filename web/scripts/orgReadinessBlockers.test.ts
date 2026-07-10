/**
 * Lightweight assert tests for orgReadinessBlockers ranking.
 * Run: npx --yes tsx scripts/orgReadinessBlockers.test.ts
 */
import assert from "node:assert/strict";
import { groupBlockerFindings, unblockedControlIds, type BlockerFinding } from "../src/lib/orgReadinessBlockers";

const findings: BlockerFinding[] = [
  { id: "1", check_id: "iam.user.no_mfa", severity: "high" },
  { id: "2", check_id: "iam.user.no_mfa", severity: "high" },
  { id: "3", check_id: "cloudtrail.not_enabled", severity: "critical" },
];

const withoutStatus = groupBlockerFindings(findings, 3);
assert.ok(withoutStatus.length >= 1);
for (const g of withoutStatus) {
  assert.equal(g.failingControlIds.length, 0);
}

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
