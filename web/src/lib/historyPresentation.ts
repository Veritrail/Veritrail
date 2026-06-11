import type { HistoryEvent, HistoryEventType } from "./complianceHistory";

const DETAIL_NOISE = /^(fast verify:|verify:|auto:)\s*/i;
const SCAN_CLEARED_NOTE = /^(?:not present in latest scan|fixed|cleared in scan|no longer detected)$/i;
const NO_LONGER_PRESENT_NOTE = /^.+\s+is no longer present$/i;
const FAST_VERIFY_NOTE = /^(?:fast verify:\s*)?resource passes check in aws$/i;
const SUPERSEDED_NOTE = /^superseded by\b/i;

function stripDetailNoise(detail: string): string {
  return detail.replace(DETAIL_NOISE, "").trim();
}

/** Ensure user-facing detail lines start with a capital letter. */
export function sentenceCaseDetail(text: string): string {
  const s = text.trim();
  if (!s) return s;
  const first = s.charAt(0);
  if (first === first.toUpperCase() && first !== first.toLowerCase()) return s;
  return first.toUpperCase() + s.slice(1);
}

/** User-facing detail for resolved finding events (History table + cards). */
export function formatResolvedFindingDetail(detail?: string | null): string {
  const raw = (detail ?? "").trim();
  if (!raw) return "Manually verified";
  if (FAST_VERIFY_NOTE.test(raw)) return "Verified via AWS API";
  if (SCAN_CLEARED_NOTE.test(raw) || NO_LONGER_PRESENT_NOTE.test(raw)) return "No longer detected";
  if (SUPERSEDED_NOTE.test(raw)) return "Superseded";
  const cleaned = stripDetailNoise(raw);
  if (FAST_VERIFY_NOTE.test(cleaned) || /^resource passes check in aws$/i.test(cleaned)) return "Verified via AWS API";
  if (SCAN_CLEARED_NOTE.test(cleaned) || NO_LONGER_PRESENT_NOTE.test(cleaned)) return "No longer detected";
  if (SUPERSEDED_NOTE.test(cleaned)) return "Superseded";
  return sentenceCaseDetail(cleaned) || "Manually verified";
}

export type EventPresentation = {
  headline: string;
  subline: string;
  tone: "regressed" | "improved" | "baseline" | "neutral";
  dotClass: string;
  cardClass: string;
};

export function eventPresentation(event: HistoryEvent): EventPresentation {
  const before = event.posture_before;
  const after = event.posture_after;

  if (event.type === "finding_resolved") {
    return {
      headline: "Finding resolved",
      subline: formatResolvedFindingDetail(event.detail),
      tone: "improved",
      dotClass: "bg-emerald-500 ring-emerald-100",
      cardClass: "border-emerald-200/70 bg-emerald-50/20",
    };
  }

  if (event.type === "finding_excepted") {
    return {
      headline: "Exception recorded",
      subline: event.detail || event.top_change?.title || "Accepted risk recorded for this finding",
      tone: "neutral",
      dotClass: "bg-amber-400 ring-amber-100",
      cardClass: "border-amber-200/80 bg-amber-50/25",
    };
  }

  if (event.type === "finding_reopened") {
    return {
      headline: "Finding reopened",
      subline: event.detail || event.top_change?.title || "A previously closed finding is active again",
      tone: "regressed",
      dotClass: "bg-red-500 ring-red-100",
      cardClass: "border-red-200/80 bg-red-50/25",
    };
  }

  if (event.type === "baseline_established") {
    const discovered = event.findings_discovered ?? event.findings_opened;
    return {
      headline: "Initial compliance baseline",
      subline:
        discovered > 0
          ? `${discovered} finding${discovered === 1 ? "" : "s"} at first scan`
          : "First recorded posture in this window",
      tone: "baseline",
      dotClass: "bg-zinc-400 ring-zinc-200",
      cardClass: "border-zinc-200/90 bg-zinc-50/40",
    };
  }

  if (event.type === "compliance_regressed") {
    return {
      headline: "Compliance regressed",
      subline: scoreSubline(before, after),
      tone: "regressed",
      dotClass: "bg-red-500 ring-red-100",
      cardClass: "border-red-200/80 bg-red-50/25",
    };
  }

  if (event.type === "compliance_improved") {
    return {
      headline: "Compliance improved",
      subline: scoreSubline(before, after),
      tone: "improved",
      dotClass: "bg-emerald-500 ring-emerald-100",
      cardClass: "border-emerald-200/70 bg-emerald-50/20",
    };
  }

  return {
    headline: "Posture snapshot recorded",
    subline: scoreSubline(before, after),
    tone: "neutral",
    dotClass: "bg-indigo-400 ring-indigo-100",
    cardClass: "border-zinc-200/90 bg-white",
  };
}

function scoreSubline(before: number | null, after: number | null): string {
  if (after == null) return "Control status updated";
  if (before == null) return `Score now ${after}%`;
  if (before === after) return `Score held at ${after}%`;
  return `Score ${before}% → ${after}%`;
}

export function primaryCause(event: HistoryEvent): {
  controlId: string;
  title: string;
  transition: string;
} | null {
  const fail = event.diff.newly_failed[0];
  if (fail) {
    return {
      controlId: fail.control_id,
      title: fail.title,
      transition: "PASS → FAIL",
    };
  }
  const pass = event.diff.newly_passed[0];
  if (pass) {
    return {
      controlId: pass.control_id,
      title: pass.title,
      transition: "FAIL → PASS",
    };
  }
  const top = event.top_change;
  if (top?.control_id) {
    const transition =
      top.direction === "regressed"
        ? "PASS → FAIL"
        : top.direction === "improved"
          ? "FAIL → PASS"
          : "Updated";
    return { controlId: top.control_id, title: top.title, transition };
  }
  return null;
}

export type ImpactItem = {
  value: number;
  label: string;
  tone: "bad" | "good" | "neutral";
  direction: "up" | "down" | "flat";
};

export function impactItems(event: HistoryEvent): ImpactItem[] {
  if (event.type === "finding_resolved" || event.type === "finding_excepted") {
    return [
      {
        value: 1,
        label: event.type === "finding_resolved" ? "finding resolved" : "exception recorded",
        tone: "good",
        direction: "down",
      },
    ];
  }
  if (event.type === "finding_reopened") {
    return [
      {
        value: 1,
        label: "finding reopened",
        tone: "bad",
        direction: "up",
      },
    ];
  }

  if (event.type === "baseline_established") {
    const items: ImpactItem[] = [];
    const open = event.findings_discovered ?? event.findings_opened;
    if (open > 0) {
      items.push({
        value: open,
        label: "open findings in baseline",
        tone: "neutral",
        direction: "flat",
      });
    }
    const failing = event.controls_failed_after ?? event.snapshot?.controls_failed ?? 0;
    if (failing > 0) {
      items.push({
        value: failing,
        label: `failing control${failing === 1 ? "" : "s"}`,
        tone: "bad",
        direction: "flat",
      });
    }
    return items;
  }

  const items: ImpactItem[] = [];
  if (event.findings_opened > 0) {
    items.push({
      value: event.findings_opened,
      label: `finding${event.findings_opened === 1 ? "" : "s"} opened`,
      tone: "bad",
      direction: "up",
    });
  }
  if (event.findings_resolved > 0) {
    items.push({
      value: event.findings_resolved,
      label: `finding${event.findings_resolved === 1 ? "" : "s"} resolved`,
      tone: "good",
      direction: "down",
    });
  }
  if (event.new_failures_count > 0) {
    items.push({
      value: event.new_failures_count,
      label: `control${event.new_failures_count === 1 ? "" : "s"} regressed`,
      tone: "bad",
      direction: "up",
    });
  }
  if (event.resolved_count > 0) {
    items.push({
      value: event.resolved_count,
      label: `control${event.resolved_count === 1 ? "" : "s"} improved`,
      tone: "good",
      direction: "down",
    });
  }
  return items;
}

export function causeSentence(event: HistoryEvent): { control: string; text: string; tone: "bad" | "good" | "neutral" } | null {
  if (event.type === "finding_resolved") {
    return { control: event.top_change?.title || "Finding", text: "was verified as resolved", tone: "good" };
  }
  if (event.type === "finding_excepted") {
    return { control: event.top_change?.title || "Finding", text: "was accepted as an exception", tone: "neutral" };
  }
  if (event.type === "finding_reopened") {
    return { control: event.top_change?.title || "Finding", text: "was reopened", tone: "bad" };
  }
  const c = primaryCause(event);
  if (!c) return null;
  const control = `${c.title} (${c.controlId})`;
  if (c.transition === "PASS → FAIL") return { control, text: "started failing", tone: "bad" };
  if (c.transition === "FAIL → PASS") return { control, text: "now passing", tone: "good" };
  return { control, text: "changed status", tone: "neutral" };
}

export function impactLines(event: HistoryEvent): string[] {
  const lines: string[] = [];
  if (event.type === "finding_resolved") return ["1 finding resolved"];
  if (event.type === "finding_excepted") return ["1 exception recorded"];
  if (event.type === "finding_reopened") return ["1 finding reopened"];
  if (event.findings_opened > 0) {
    lines.push(`+${event.findings_opened} finding${event.findings_opened === 1 ? "" : "s"} opened`);
  }
  if (event.findings_resolved > 0) {
    lines.push(`${event.findings_resolved} finding${event.findings_resolved === 1 ? "" : "s"} resolved`);
  }
  if (event.new_failures_count > 0) {
    lines.push(
      `${event.new_failures_count} control${event.new_failures_count === 1 ? "" : "s"} regressed`,
    );
  }
  if (event.resolved_count > 0) {
    lines.push(`${event.resolved_count} control${event.resolved_count === 1 ? "" : "s"} improved`);
  }
  if (event.type === "baseline_established") {
    const d = event.findings_discovered ?? event.findings_opened;
    if (d > 0) lines.push(`${d} open findings in baseline`);
    const failing = event.controls_failed_after ?? event.snapshot?.controls_failed ?? 0;
    if (failing > 0) lines.push(`${failing} failing control${failing === 1 ? "" : "s"}`);
    return lines;
  }
  return lines;
}

export function eventTypeLabel(type: HistoryEventType): string {
  switch (type) {
    case "baseline_established":
      return "Baseline";
    case "compliance_regressed":
      return "Regression";
    case "compliance_improved":
      return "Improvement";
    case "finding_resolved":
      return "Remediation";
    case "finding_excepted":
      return "Exception";
    case "finding_reopened":
      return "Reopened";
    default:
      return "Snapshot";
  }
}
