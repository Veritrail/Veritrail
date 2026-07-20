/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  presentCapabilityLane,
  presentRollupLabel,
} from "./capabilityPresentation";

describe("capabilityPresentation", () => {
  it("maps internal states to evidence language", () => {
    const covered = presentCapabilityLane({
      capability: "dependency_scanning",
      label: "Dependency scanning (SCA)",
      status: "covered",
      providers: ["github_dependabot"],
      coverage: { eligible: 42, assessed: 42 },
      limitations: [],
    });
    expect(covered.title).toBe("Verified");
    expect(covered.explanation).toContain("42 of 42");

    expect(
      presentCapabilityLane({
        capability: "x",
        label: "X",
        status: "unknown",
        providers: [],
        coverage: { eligible: 0, assessed: 0 },
        limitations: ["permission_denied"],
        limitations_detail: [
          {
            code: "permission_denied",
            impact: "blocking",
            title: "Permission required",
            explanation: "Veritrail could not read the evidence needed.",
            action: "Grant read permission, then sync again.",
          },
        ],
      }).title,
    ).toBe("Not enough evidence");
  });

  it("never surfaces rollup or snake_case as the primary label", () => {
    expect(presentRollupLabel("action_needed")).toBe("Action needed");
    expect(presentRollupLabel("verified")).toBe("Verified");
    const presented = presentCapabilityLane({
      capability: "secret_scanning",
      label: "Secret scanning",
      status: "partial",
      providers: [],
      coverage: { eligible: 3, assessed: 1 },
      limitations: ["enabled_without_observable_activity"],
      limitations_detail: [
        {
          code: "enabled_without_observable_activity",
          impact: "degrading",
          title: "Enabled but inactive",
          explanation: "Enabled without observable activity.",
          action: "Confirm the feature is running.",
        },
      ],
    });
    expect(presented.title).toBe("Incomplete evidence");
    expect(presented.explanation.toLowerCase()).not.toContain("enabled_without");
    expect(presented.action).toBe("Confirm the feature is running.");
  });

  it("maps unvalidated Beta to withheld copy, not covered", () => {
    const presented = presentCapabilityLane({
      capability: "host_workload_scanning",
      label: "Host/workload scanning",
      status: "unvalidated",
      providers: ["crowdstrike"],
      coverage: { eligible: 12, assessed: 12 },
      limitations: ["edr_unvalidated_beta"],
      limitations_detail: [
        {
          code: "edr_unvalidated_beta",
          impact: "informational",
          title: "EDR Beta unvalidated",
          explanation: "Evidence collected; verdict withheld until live validation.",
          action: "Complete live validation, then set ga_validated.",
        },
      ],
    });
    expect(presented.title).toBe("Unvalidated (Beta)");
    expect(presented.statusClass).toBe("unvalidated");
    expect(presented.statusClass).not.toBe("covered");
    expect(presented.title.toLowerCase()).not.toContain("verified");
  });
});
