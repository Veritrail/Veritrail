/**
 * Plain-language presentation for technical capability lanes (hardening Phase E).
 * Browser must never humanize arbitrary snake_case limitation codes — use
 * server-provided limitations_detail when present.
 */

export type CapabilityLaneStatus =
  | "covered"
  | "partial"
  | "unvalidated"
  | "not_covered"
  | "stale"
  | "not_applicable"
  | "unknown"
  | string;

export type LimitationDetail = {
  code: string;
  impact?: string;
  title: string;
  explanation: string;
  action: string;
};

export type CapabilityLaneView = {
  capability: string;
  label: string;
  status: CapabilityLaneStatus;
  providers: string[];
  coverage: { eligible: number; assessed: number; excluded?: number };
  open_findings?: { critical?: number; high?: number; medium?: number; low?: number };
  limitations?: string[];
  limitations_detail?: LimitationDetail[];
  action?: string | null;
  verdict_reason?: string | null;
  next_action?: string | null;
};

const STATUS_COPY: Record<
  string,
  { title: string; explanation: (lane: CapabilityLaneView) => string }
> = {
  covered: {
    title: "Verified",
    explanation: (lane) => {
      const { assessed, eligible } = lane.coverage;
      if (eligible > 0) {
        return `Fresh evidence covers ${assessed} of ${eligible} in-scope assets.`;
      }
      return "Fresh evidence verifies this capability for the connected scope.";
    },
  },
  partial: {
    title: "Incomplete evidence",
    explanation: (lane) => {
      const { assessed, eligible } = lane.coverage;
      if (eligible > 0) {
        return `Evidence covers ${assessed} of ${eligible} in-scope assets.`;
      }
      return "Evidence for this capability is incomplete.";
    },
  },
  unvalidated: {
    title: "Unvalidated (Beta)",
    explanation: () =>
      "Evidence was collected from an unvalidated Beta provider; the verdict is withheld until live validation.",
  },
  stale: {
    title: "Evidence needs refresh",
    explanation: () => "The last complete evidence is older than the freshness window for this capability.",
  },
  not_covered: {
    title: "Capability not enabled",
    explanation: () => "No qualifying source is protecting the in-scope assets.",
  },
  unknown: {
    title: "Not enough evidence",
    explanation: (lane) => {
      const detail = primaryLimitation(lane);
      if (detail?.explanation) return detail.explanation;
      return "Veritrail could not determine coverage for this capability.";
    },
  },
  not_applicable: {
    title: "Not applicable",
    explanation: () => "No applicable assets were found in the connected scope.",
  },
};

export function primaryLimitation(lane: CapabilityLaneView): LimitationDetail | null {
  const details = lane.limitations_detail;
  if (details?.length) {
    const rank = (impact?: string) =>
      impact === "blocking" ? 0 : impact === "degrading" ? 1 : 2;
    return [...details].sort((a, b) => rank(a.impact) - rank(b.impact))[0] ?? null;
  }
  return null;
}

export function presentCapabilityLane(lane: CapabilityLaneView): {
  title: string;
  explanation: string;
  action: string | null;
  statusClass: string;
} {
  const copy = STATUS_COPY[lane.status] ?? STATUS_COPY.unknown;
  const detail = primaryLimitation(lane);
  const explanation =
    lane.verdict_reason?.trim() ||
    (lane.status === "unknown" || lane.status === "partial" || lane.status === "unvalidated"
      ? detail?.explanation || copy.explanation(lane)
      : copy.explanation(lane));
  const action =
    (lane.next_action || lane.action || detail?.action || null)?.trim() || null;

  return {
    title: copy.title,
    explanation,
    action,
    statusClass: lane.status,
  };
}

/** Never show raw rollup enums or snake_case codes in the drawer. */
export function presentRollupLabel(rollup: string | null | undefined): string | null {
  if (!rollup) return null;
  const map: Record<string, string> = {
    verified: "Verified",
    action_needed: "Action needed",
    needs_evidence: "Needs evidence",
  };
  return map[rollup] ?? null;
}
