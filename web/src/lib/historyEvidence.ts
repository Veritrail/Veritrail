// Helpers that turn a compliance-timeline event into resource-first evidence:
// a readable resource label, a clean change phrase, an event-type badge, the
// mapped control, and a posture sparkline series.
import type { HistoryEvent, HistoryEventType, PostureTrendPoint, SnapshotSummary } from "./complianceHistory";
import { formatResolvedFindingDetail, primaryCause, sentenceCaseDetail } from "./historyPresentation";

export type ResourceRef = { kind: string; name: string };

const ARN_SERVICE_KIND: Record<string, string> = {
  s3: "S3",
  iam: "IAM",
  kms: "KMS",
  ec2: "EC2",
  rds: "RDS",
  dynamodb: "DynamoDB",
  lambda: "Lambda",
  sns: "SNS",
  sqs: "SQS",
  cloudtrail: "CloudTrail",
  elasticloadbalancing: "ELB",
  acm: "ACM",
  guardduty: "GuardDuty",
  secretsmanager: "Secrets",
  ssm: "SSM",
  config: "Config",
  "access-analyzer": "Access Analyzer",
  securityhub: "Security Hub",
};

// "arn:aws:iam::123:role/Admin" -> { kind: "IAM role", name: "Admin" }
export function shortResource(arn?: string | null): ResourceRef | null {
  if (!arn) return null;
  if (!arn.startsWith("arn:")) {
    // GitHub/GitLab identifiers etc. — show the trailing segment.
    const tail = arn.split("/").slice(-2).join("/");
    return { kind: "Resource", name: tail || arn };
  }
  const parts = arn.split(":");
  const service = parts[2] || "";
  const resource = parts.slice(5).join(":") || parts[5] || "";
  const [type, ...rest] = resource.includes("/") ? resource.split("/") : [resource];
  const name = (rest.length ? rest.join("/") : type) || resource;
  const base = ARN_SERVICE_KIND[service] ?? service.toUpperCase();
  const kind = rest.length && type && type !== name ? `${base} ${type}` : base;
  return { kind, name };
}

const DETAIL_NOISE = /^(fast verify:|verify:|auto:)\s*/i;

export function cleanDetail(detail?: string | null): string {
  if (!detail) return "";
  return sentenceCaseDetail(detail.replace(DETAIL_NOISE, "").trim());
}

export type EventBadge = {
  label: string;
  dot: string;
  text: string;
  chip: string;
  rail: string;
};

export function eventBadge(type: HistoryEventType): EventBadge {
  switch (type) {
    case "finding_resolved":
    case "compliance_improved":
      return {
        label: type === "finding_resolved" ? "Resolved" : "Improved",
        dot: "bg-emerald-500",
        text: "text-emerald-700",
        chip: "bg-emerald-50 text-emerald-700 ring-emerald-100",
        rail: "border-emerald-400/70",
      };
    case "finding_excepted":
      return {
        label: "Exception",
        dot: "bg-amber-400",
        text: "text-amber-700",
        chip: "bg-amber-50 text-amber-800 ring-amber-100",
        rail: "border-amber-300/80",
      };
    case "finding_reopened":
    case "compliance_regressed":
      return {
        label: type === "finding_reopened" ? "Reopened" : "Regressed",
        dot: "bg-rose-500",
        text: "text-rose-700",
        chip: "bg-rose-50 text-rose-700 ring-rose-100",
        rail: "border-rose-400/70",
      };
    case "baseline_established":
      return {
        label: "Baseline",
        dot: "bg-zinc-400",
        text: "text-zinc-600",
        chip: "bg-zinc-100 text-zinc-600 ring-zinc-200/70",
        rail: "border-zinc-300",
      };
    default:
      return {
        label: "Scan",
        dot: "bg-indigo-400",
        text: "text-indigo-700",
        chip: "bg-indigo-50 text-indigo-700 ring-indigo-100",
        rail: "border-indigo-300/70",
      };
  }
}

// Mapped control for the row chip: prefer an explicit finding control, else the
// scan's primary changed control.
export function controlOf(event: HistoryEvent): { id: string; title: string } | null {
  if (event.top_change?.control_id) {
    return { id: event.top_change.control_id, title: event.top_change.title };
  }
  const cause = primaryCause(event);
  return cause ? { id: cause.controlId, title: cause.title } : null;
}

export type EventFilter = "all" | "improved" | "regressed" | "exceptions";

export type HistoryTypeDisplay = {
  label: string;
  className: string;
};

export function historyTypeDisplay(event: HistoryEvent): HistoryTypeDisplay {
  const type = event.type;
  if (type === "scan_with_changes") {
    const before = event.posture_before;
    const after = event.posture_after;
    if (before != null && after != null && after !== before) {
      return after > before
        ? { label: "Improved", className: "history-type--improved" }
        : { label: "Regressed", className: "history-type--regressed" };
    }
    if ((event.diff?.newly_failed?.length ?? 0) > (event.diff?.newly_passed?.length ?? 0)) {
      return { label: "Regressed", className: "history-type--regressed" };
    }
    return { label: "Improved", className: "history-type--improved" };
  }
  switch (type) {
    case "compliance_improved":
      return { label: "Improved", className: "history-type--improved" };
    case "compliance_regressed":
      return { label: "Regressed", className: "history-type--regressed" };
    case "finding_resolved":
      return { label: "Resolved", className: "history-type--resolved" };
    case "finding_excepted":
      return { label: "Exception", className: "history-type--exception" };
    case "finding_reopened":
      return { label: "Reopened", className: "history-type--reopened" };
    case "baseline_established":
      return { label: "Baseline", className: "history-type--baseline" };
    default:
      return { label: "Changed", className: "history-type--baseline" };
  }
}

export function matchesEventFilter(event: HistoryEvent, filter: EventFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "improved":
      return event.type === "finding_resolved" || event.type === "compliance_improved";
    case "regressed":
      return event.type === "finding_reopened" || event.type === "compliance_regressed";
    case "exceptions":
      return event.type === "finding_excepted";
    default:
      return true;
  }
}

export function historyResourceLabel(event: HistoryEvent): string {
  const res = shortResource(event.resource_arn);
  if (res) {
    const kind = res.kind.replace(/\b\w/g, (c) => c.toUpperCase());
    return `${kind} ${res.name}`.trim();
  }
  const control = controlOf(event);
  if (control) return control.title;
  return event.top_change?.title ?? "—";
}

export function historyDetailLine(event: HistoryEvent): string {
  if (event.type === "finding_resolved") {
    return formatResolvedFindingDetail(event.detail);
  }
  const detail = cleanDetail(event.detail);
  if (detail) return detail;
  const control = controlOf(event);
  if (control && event.type.startsWith("finding_")) return sentenceCaseDetail(control.title);
  if (event.diff?.newly_failed?.[0]) return sentenceCaseDetail(event.diff.newly_failed[0].title);
  if (event.diff?.newly_passed?.[0]) return sentenceCaseDetail(event.diff.newly_passed[0].title);
  const fallback = event.top_change?.title ?? "";
  return fallback ? sentenceCaseDetail(fallback) : "";
}

export function scanCoverageDays(
  scanCadence: { date: string; scan_count: number }[] | undefined,
  periodDays: number,
): { covered: number; total: number; gap: number } {
  const covered = scanCadence?.filter((d) => d.scan_count > 0).length ?? 0;
  const total = periodDays;
  return { covered, total, gap: Math.max(0, total - covered) };
}

export function matchesControl(event: HistoryEvent, controlId: string | null): boolean {
  if (!controlId) return true;
  if (controlOf(event)?.id === controlId) return true;
  return (
    event.diff?.newly_failed?.some((c) => c.control_id === controlId) ||
    event.diff?.newly_passed?.some((c) => c.control_id === controlId) ||
    false
  );
}

export type PosturePoint = { t: string; posture: number };

// Chronological posture series for the sparkline (oldest → newest).
export function postureSeries(events: HistoryEvent[]): PosturePoint[] {
  const chron = [...events].reverse(); // API returns newest-first
  const pts: PosturePoint[] = [];
  let seededBaseline = false;
  for (const e of chron) {
    if (!seededBaseline && e.posture_before != null) {
      pts.push({ t: e.timestamp, posture: e.posture_before });
      seededBaseline = true;
    }
    if (e.posture_after != null) pts.push({ t: e.timestamp, posture: e.posture_after });
  }
  return pts;
}

const SCAN_SNAPSHOT_TYPES = new Set<HistoryEventType>([
  "baseline_established",
  "compliance_improved",
  "compliance_regressed",
  "scan_with_changes",
]);

function eventPosture(event: HistoryEvent): number | null {
  return event.posture_after ?? event.snapshot?.posture_score ?? null;
}

/** Nearest scan snapshot at or before a timestamp; falls back to the next scan after. */
export function nearestScanEvent(events: HistoryEvent[], atIso: string): HistoryEvent | null {
  const at = new Date(atIso).getTime();
  let before: HistoryEvent | null = null;
  let after: HistoryEvent | null = null;

  for (const e of events) {
    if (!SCAN_SNAPSHOT_TYPES.has(e.type)) continue;
    const t = new Date(e.timestamp).getTime();
    if (t <= at) {
      if (!before || t > new Date(before.timestamp).getTime()) before = e;
    } else if (!after || t < new Date(after.timestamp).getTime()) {
      after = e;
    }
  }
  return before ?? after;
}

function postureFromTrend(points: PostureTrendPoint[], atIso: string): number | null {
  const at = new Date(atIso).getTime();
  let best: number | null = null;
  let bestTs = -1;
  for (const p of points) {
    const t = new Date(p.timestamp).getTime();
    if (t <= at && t >= bestTs) {
      bestTs = t;
      best = p.posture_score;
    }
  }
  return best;
}

/** Posture % for drawer display — finding events inherit the nearest scan; missing → 0. */
export function drawerPostureScore(
  event: HistoryEvent,
  allEvents: HistoryEvent[],
  trend: PostureTrendPoint[],
): number {
  const direct = eventPosture(event);
  if (direct != null) return direct;
  const scan = nearestScanEvent(allEvents, event.timestamp);
  const fromScan = scan ? eventPosture(scan) : null;
  if (fromScan != null) return fromScan;
  const fromTrend = postureFromTrend(trend, event.timestamp);
  if (fromTrend != null) return fromTrend;
  return 0;
}

/** Control counts for drawer — finding lifecycle events use the nearest scan snapshot. */
export function drawerSnapshotSummary(event: HistoryEvent, allEvents: HistoryEvent[]): SnapshotSummary {
  if (event.posture_after != null || event.controls_passed_after != null) {
    return event.snapshot;
  }
  if (!event.type.startsWith("finding_")) return event.snapshot;
  const scan = nearestScanEvent(allEvents, event.timestamp);
  if (scan?.snapshot) return scan.snapshot;
  return event.snapshot;
}

/** Prior scan snapshot to compare against — skips adjacent finding rows on the same day. */
export function drawerComparePreviousScan(
  allEvents: HistoryEvent[],
  event: HistoryEvent,
): HistoryEvent | null {
  const at = new Date(event.timestamp).getTime();
  let best: HistoryEvent | null = null;
  for (const e of allEvents) {
    if (!SCAN_SNAPSHOT_TYPES.has(e.type)) continue;
    if (e.scan_run_id === event.scan_run_id) continue;
    const t = new Date(e.timestamp).getTime();
    if (t < at && (!best || t > new Date(best.timestamp).getTime())) {
      best = e;
    }
  }
  return best;
}

export function snapshotOpenFindings(snap: SnapshotSummary | undefined): number | null {
  if (snap?.open_findings_count != null) return snap.open_findings_count;
  return null;
}

/** Finding remediations strictly after ``afterIso`` through ``throughIso`` (exclusive → inclusive). */
export function remediationsBetween(
  allEvents: HistoryEvent[],
  afterIso: string,
  throughIso: string,
): number {
  const after = new Date(afterIso).getTime();
  const through = new Date(throughIso).getTime();
  let n = 0;
  for (const e of allEvents) {
    if (e.type !== "finding_resolved" && e.type !== "finding_excepted") continue;
    const t = new Date(e.timestamp).getTime();
    if (t > after && t <= through) n += 1;
  }
  return n;
}

export function reopeningsBetween(
  allEvents: HistoryEvent[],
  afterIso: string,
  throughIso: string,
): number {
  const after = new Date(afterIso).getTime();
  const through = new Date(throughIso).getTime();
  let n = 0;
  for (const e of allEvents) {
    if (e.type !== "finding_reopened") continue;
    const t = new Date(e.timestamp).getTime();
    if (t > after && t <= through) n += 1;
  }
  return n;
}

/** Control tied to a finding event when the control did not fully pass/fail. */
export function findingRemediatedControl(event: HistoryEvent): { control_id: string; title: string } | null {
  if (!event.type.startsWith("finding_")) return null;
  if ((event.diff?.newly_passed?.length ?? 0) > 0 || (event.diff?.newly_failed?.length ?? 0) > 0) {
    return null;
  }
  const c = controlOf(event);
  if (!c) return null;
  return { control_id: c.id, title: c.title };
}

export function drawerPostureDelta(
  event: HistoryEvent,
  previousEvent: HistoryEvent | null,
  allEvents: HistoryEvent[],
  trend: PostureTrendPoint[],
): number | null {
  const current = drawerPostureScore(event, allEvents, trend);
  let prior: number | null = null;
  if (previousEvent) {
    prior = drawerPostureScore(previousEvent, allEvents, trend);
  } else if (event.posture_before != null) {
    prior = event.posture_before;
  }
  if (prior == null || prior === current) return null;
  return current - prior;
}
