// Helpers that turn a compliance-timeline event into resource-first evidence:
// a readable resource label, a clean change phrase, an event-type badge, the
// mapped control, and a posture sparkline series.
import type { HistoryEvent, HistoryEventType } from "./complianceHistory";
import { primaryCause } from "./historyPresentation";

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
  return detail.replace(DETAIL_NOISE, "").trim();
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

export type EventFilter = "all" | "resolved" | "regressed" | "exceptions" | "scans";

export function matchesEventFilter(event: HistoryEvent, filter: EventFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "resolved":
      return event.type === "finding_resolved" || event.type === "compliance_improved";
    case "regressed":
      return event.type === "finding_reopened" || event.type === "compliance_regressed";
    case "exceptions":
      return event.type === "finding_excepted";
    case "scans":
      return event.type === "scan_with_changes" || event.type === "baseline_established";
    default:
      return true;
  }
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
