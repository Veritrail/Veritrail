import assert from "node:assert/strict";

import { collapseFindingLifecycles } from "../src/lib/controlHistory.ts";

const collapsed = collapseFindingLifecycles([
  {
    timestamp: "2026-06-11T18:54:02Z",
    type: "finding_detected",
    finding_id: "finding-open",
    finding_status: "open",
    detail: "No AWS Backup plans configured",
  },
  {
    timestamp: "2026-06-11T18:54:09Z",
    type: "finding_opened",
    finding_id: "finding-open",
    finding_status: "open",
    detail: "No AWS Backup plans configured",
  },
  {
    timestamp: "2026-05-31T18:08:00Z",
    type: "finding_detected",
    finding_id: "finding-resolved",
    finding_status: "resolved",
    detail: "RDS instance does not have deletion protection enabled",
  },
  {
    timestamp: "2026-06-12T07:00:00Z",
    type: "finding_resolved",
    finding_id: "finding-resolved",
    finding_status: "resolved",
    detail: "RDS instance does not have deletion protection enabled",
  },
  {
    timestamp: "2026-06-10T10:00:00Z",
    type: "finding_detected",
    finding_id: "supporting-only",
    finding_status: "open",
    affects_control_status: false,
    detail: "Supporting signal that does not grade this control",
  },
]);

assert.equal(collapsed.length, 2, "one lifecycle row should render per finding");
assert.equal(collapsed[0]?.finding_id, "finding-open");
assert.equal(collapsed[0]?.type, "finding_open", "current findings should be explicit");
assert.equal(collapsed[1]?.finding_id, "finding-resolved");
assert.equal(collapsed[1]?.type, "finding_resolved", "historical findings should show their current state");
assert.equal(
  collapsed[1]?.timestamp,
  "2026-05-31T18:08:00Z",
  "the lifecycle row should retain the original detection time",
);

const legacy = collapseFindingLifecycles([
  {
    timestamp: "2026-06-11T18:54:02Z",
    type: "finding_detected",
    detail: "No AWS Backup plans configured",
  },
  {
    timestamp: "2026-06-11T18:54:09Z",
    type: "finding_opened",
    detail: "No AWS Backup plans configured",
  },
]);

assert.equal(legacy.length, 1, "cached legacy detected/opened pairs should also collapse");

console.log("Control history lifecycle regression checks passed.");
