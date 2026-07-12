// Helpers that turn a compliance-timeline event into resource-first evidence:
// a readable resource label, a clean change phrase, an event-type badge, the
// mapped control, and a posture sparkline series.
import type { HistoryEvent, HistoryEventType, PostureTrendPoint, SnapshotSummary } from "./complianceHistory";
import { labelForCheck } from "../data/checkLabels";
import { formatResolvedFindingDetail, primaryCause, sentenceCaseDetail } from "./historyPresentation";
import { maskSensitiveText } from "./sensitiveDisplay";

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

const IAM_ACCESS_KEY_SUFFIX_RE = /#(?:AKIA|ASIA|AROA)[A-Z0-9]{16}$/i;

function formatIamResourceSegment(name: string): string {
  return maskSensitiveText(name.replace(IAM_ACCESS_KEY_SUFFIX_RE, ""));
}

export function historyResourceLabel(event: HistoryEvent): string {
  const res = shortResource(event.resource_arn);
  if (res) {
    const kind = res.kind.replace(/\b\w/g, (c) => c.toUpperCase());
    return `${kind} ${formatIamResourceSegment(res.name)}`.trim();
  }
  const control = controlOf(event);
  if (control) return control.title;
  return maskSensitiveText(event.top_change?.title ?? "—");
}

function findingCheckLabel(event: HistoryEvent): string | null {
  if (!event.check_id) return null;
  return labelForCheck(event.check_id);
}

function enrichedResolvedDetail(event: HistoryEvent): string {
  const formatted = formatResolvedFindingDetail(event.detail);
  const checkLabel = findingCheckLabel(event);
  if (checkLabel && (formatted === "No longer detected" || formatted === "Manually verified")) {
    return `${formatted} — ${checkLabel}`;
  }
  return formatted;
}

export function historyDetailLine(event: HistoryEvent): string {
  if (event.type === "finding_resolved") {
    return enrichedResolvedDetail(event);
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

export type CompositeGroupScope = {
  checkIds: Set<string>;
};

/** Scope a composite group by its mapped check IDs only (not whole SOC2 controls). */
export function buildCompositeGroupScope(composite: { check_ids: string[] }): CompositeGroupScope {
  return { checkIds: new Set(composite.check_ids) };
}

/**
 * Match history events to a composite group via finding check_id.
 * We intentionally do not match whole framework controls (e.g. CC6.6): one control
 * can span S3, IAM, and GitHub checks, so control-level matching pulls in unrelated resources.
 */
export function matchesCompositeGroup(event: HistoryEvent, scope: CompositeGroupScope | null): boolean {
  if (!scope) return true;
  return Boolean(event.check_id && scope.checkIds.has(event.check_id));
}

const GROUPABLE_FINDING_EVENT_TYPES = new Set<HistoryEventType>([
  "finding_resolved",
  "finding_excepted",
  "finding_reopened",
]);

function findingEventGroupKey(event: HistoryEvent): string | null {
  if (!GROUPABLE_FINDING_EVENT_TYPES.has(event.type)) return null;
  const control = controlOf(event);
  const minute = event.timestamp.slice(0, 16);
  const resource = historyResourceLabel(event).toLowerCase();
  return `${event.type}|${minute}|${control?.id ?? ""}|${resource}`;
}

function mergeFindingEventGroup(group: HistoryEvent[]): HistoryEvent {
  if (group.length === 1) return group[0];
  const primary = group[0];
  const labels = [
    ...new Set(
      group.map((event) => findingCheckLabel(event)).filter((label): label is string => Boolean(label)),
    ),
  ];
  const base = formatResolvedFindingDetail(primary.detail);
  const detail =
    labels.length > 0
      ? `${base === "Manually verified" ? "No longer detected" : base} — ${labels.join(", ")}`
      : base;

  return {
    ...primary,
    scan_run_id: group.map((event) => event.scan_run_id).join("+"),
    findings_resolved: group.reduce((sum, event) => sum + (event.findings_resolved ?? 0), 0),
    detail,
  };
}

/** Collapse same-minute finding events that share control + resource (different checks, one user). */
export function collapseRedundantFindingEvents(events: HistoryEvent[]): HistoryEvent[] {
  const out: HistoryEvent[] = [];
  let index = 0;
  while (index < events.length) {
    const event = events[index];
    const key = findingEventGroupKey(event);
    if (!key) {
      out.push(event);
      index += 1;
      continue;
    }
    const group = [event];
    let next = index + 1;
    while (next < events.length && findingEventGroupKey(events[next]) === key) {
      group.push(events[next]);
      next += 1;
    }
    out.push(mergeFindingEventGroup(group));
    index = next;
  }
  return out;
}

const FLAP_EVENT_TYPES = new Set(["finding_resolved", "finding_reopened"]);

function flapIdentityKey(event: HistoryEvent): string | null {
  if (!FLAP_EVENT_TYPES.has(event.type)) return null;
  const check = event.check_id ?? controlOf(event)?.id ?? "";
  const resource = event.resource_arn ?? historyResourceLabel(event);
  return `${check}|${resource}`;
}

/**
 * Collapse findings that flap between resolved and reopened across the window
 * (e.g. Root MFA resolved→reopened→resolved 4×) into one row: the latest event
 * carrying `flap_count` and the merged `flap_events` for expansion.
 * Expects newest-first input; first-time changes pass through untouched.
 */
export function collapseFlappingFindings(events: HistoryEvent[]): HistoryEvent[] {
  const groups = new Map<string, HistoryEvent[]>();
  for (const event of events) {
    const key = flapIdentityKey(event);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(event);
    else groups.set(key, [event]);
  }
  // Three or more state changes = at least one full resolve→reopen→resolve churn cycle.
  const flappingKeys = new Set(
    [...groups].filter(([, group]) => group.length >= 3).map(([key]) => key),
  );
  if (flappingKeys.size === 0) return events;

  const emitted = new Set<string>();
  const out: HistoryEvent[] = [];
  for (const event of events) {
    const key = flapIdentityKey(event);
    if (!key || !flappingKeys.has(key)) {
      out.push(event);
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    const group = groups.get(key)!;
    out.push({ ...event, flap_count: group.length, flap_events: group });
  }
  return out;
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
