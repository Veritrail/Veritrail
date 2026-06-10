import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import {
  assetTypeLabel,
  awsAccountIdFromFinding,
  daysAgo,
  findingScopeDisplayName,
  findingStatusLabel,
  resourceDisplayName,
  severityPillClassName,
} from "../lib/findingDisplay";
import {
  fetchCheckFindings,
  snapshotFindings,
  summarizeRefreshOutcome,
  waitForRecheckUpdate,
} from "../lib/recheckPoll";
import { remediationSummaryForFinding } from "../data/remediationSummaries";
import type { RecheckBatchResponse } from "../context/RecheckNotificationsContext";
import { CloudProviderMark } from "./FindingResourceIcon";

export type ResourcesTabFinding = {
  id: string;
  check_id: string;
  title?: string;
  resource_arn: string;
  severity: string;
  risk_score: number;
  status: string;
  evidence: Record<string, unknown>;
  first_seen: string;
  last_seen: string;
  account_id?: string;
  aws_account_id?: string | null;
  account_label?: string | null;
  account_name?: string | null;
  account_provider?: string | null;
};

const RESOURCE_AFFECTED_DETAIL: Record<string, string> = {
  "s3.bucket.public_access_not_blocked": "Bucket allows public access via all public access settings.",
  "s3.account.public_access_not_blocked":
    "Account level guardrails are off. One bucket misconfiguration can expose data.",
  "s3.bucket.no_https_policy": "No HTTPS only bucket policy. Objects may be read over HTTP.",
  "s3.bucket.no_kms": "Objects are stored without SSE KMS at rest.",
  "s3.bucket.no_logging": "Object-level reads and writes are not recorded to a log bucket.",
};

/** One-line reason for the Resources table — scoped to this resource, not the finding title. */
function resourceAffectedReason(finding: ResourcesTabFinding): string {
  const override = RESOURCE_AFFECTED_DETAIL[finding.check_id];
  if (override) return override;

  if (finding.check_id === "iam.role.least_privilege_policy") {
    const scope = finding.evidence?.scope;
    if (scope === "full_admin") return "Action:* + Resource:*";
    if (scope === "wildcard_action") return "Action:* (wildcard)";
    return "Broader than observed usage";
  }

  const summary = remediationSummaryForFinding(finding);
  return (summary.risk || summary.impact).replace(/\s*—\s*/g, ". ");
}

function formatResourceTableDate(iso: string, mode: "first" | "last"): { primary: string; sub: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { primary: "—", sub: "" };
  const primary = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (mode === "first") {
    return { primary, sub: daysAgo(iso) };
  }
  const sub = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return { primary, sub };
}

function dedupeByArn(findings: ResourcesTabFinding[]): ResourcesTabFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    if (seen.has(f.resource_arn)) return false;
    seen.add(f.resource_arn);
    return true;
  });
}

function aggregateSeen(findings: ResourcesTabFinding[], pick: "first_seen" | "last_seen"): string {
  const times = findings
    .map((f) => new Date(f[pick]).getTime())
    .filter((t) => !Number.isNaN(t));
  if (times.length === 0) return findings[0]?.[pick] ?? "";
  return pick === "first_seen"
    ? new Date(Math.min(...times)).toISOString()
    : new Date(Math.max(...times)).toISOString();
}

function openDaysSince(iso: string): number {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return Math.max(0, d);
}

const RESOURCE_NAME_DISPLAY_MAX = 40;
const RESOURCE_ARN_DISPLAY_MAX = 38;

function truncateDisplayText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function truncateArnDisplay(arn: string, max = RESOURCE_ARN_DISPLAY_MAX): string {
  return truncateDisplayText(arn, max);
}

function ResourceTypePill({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 whitespace-nowrap rounded-full bg-sky-50 px-2.5 py-1 text-[12px] font-semibold leading-none text-sky-700">
      {label}
    </span>
  );
}

function CopyArnButton({ arn }: { arn: string }) {
  return (
    <button
      type="button"
      aria-label="Copy resource ARN"
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard.writeText(arn);
      }}
      className="shrink-0 text-zinc-400 transition hover:text-zinc-600 focus:outline-none"
    >
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
        <rect x="3" y="2" width="13" height="16" rx="2.5" />
        <path d="M16 6h2.5A2.5 2.5 0 0 1 21 8.5v11a2.5 2.5 0 0 1-2.5 2.5h-10A2.5 2.5 0 0 1 6 19.5V18" />
      </svg>
    </button>
  );
}

function riskScoreTone(severity: string): string {
  if (severity === "critical" || severity === "high") return "text-red-600";
  if (severity === "medium") return "text-amber-600";
  return "text-zinc-900";
}

function stateStatusPill(status: string, label: string) {
  const styles: Record<string, string> = {
    open: "bg-amber-50 text-amber-700 ring-amber-200/70",
    resolved: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
    snoozed: "bg-sky-50 text-sky-700 ring-sky-200/70",
    excepted: "bg-zinc-100 text-zinc-700 ring-zinc-200/80",
    ignored: "bg-zinc-100 text-zinc-600 ring-zinc-200/80",
  };
  const dot: Record<string, string> = {
    open: "bg-amber-500",
    resolved: "bg-emerald-500",
    snoozed: "bg-sky-500",
    excepted: "bg-zinc-400",
    ignored: "bg-zinc-400",
  };
  const shell = styles[status] ?? styles.open;
  const dotClass = dot[status] ?? dot.open;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ring-inset ${shell}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
      {label}
    </span>
  );
}

function StripMetric({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
}) {
  return (
    <div className="px-4 py-3.5">
      <p className="text-[12px] font-medium text-zinc-500">{label}</p>
      <div className="mt-1.5 text-[15px] font-semibold leading-snug tabular-nums text-zinc-900">{value}</div>
      {sub ? <p className="mt-0.5 text-[12px] leading-snug text-zinc-500">{sub}</p> : null}
    </div>
  );
}

function ResourceWhyAffectedCompact({ finding }: { finding: ResourcesTabFinding }) {
  const reason = resourceAffectedReason(finding);
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-rose-100 bg-rose-50 px-3.5 py-3">
      <svg
        className="h-4 w-4 shrink-0 text-red-500"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
        />
      </svg>
      <p className="min-w-0 flex-1 hyphens-none text-[13px] font-semibold leading-snug text-red-600">
        {reason}
      </p>
    </div>
  );
}

const POSTURE_STRIP_MIN_H = "min-h-[5.25rem]";

function ResourcesPostureStrip({
  selectedFinding,
  groupFindings,
  summaryRisk,
  summaryAction,
}: {
  selectedFinding: ResourcesTabFinding;
  groupFindings: ResourcesTabFinding[];
  summaryRisk?: string | null;
  summaryAction?: string | null;
}) {
  const unique = dedupeByArn(groupFindings);
  const scoreTone = riskScoreTone(selectedFinding.severity);

  return (
    <div className={`flex flex-col gap-2.5 lg:flex-row lg:items-stretch ${POSTURE_STRIP_MIN_H}`}>
      <div
        className={`flex shrink-0 items-center gap-5 rounded-xl border border-zinc-200/90 bg-white px-5 py-3.5 shadow-sm shadow-zinc-950/[0.03] ${POSTURE_STRIP_MIN_H}`}
      >
        <div className="shrink-0">
          <p className="whitespace-nowrap text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            Affected resources
          </p>
          <p className="mt-1 text-xl font-bold leading-none tabular-nums text-zinc-900">{unique.length}</p>
        </div>
        <div className="h-9 w-px shrink-0 bg-zinc-100" aria-hidden />
        <div className="shrink-0">
          <p className="whitespace-nowrap text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            Risk score
          </p>
          <div className="mt-1 flex flex-col items-start gap-1 leading-none">
            <span className={`text-xl font-bold tabular-nums ${scoreTone}`}>
              {selectedFinding.risk_score}
            </span>
            <span
              className={`${severityPillClassName(selectedFinding.severity)} w-20 justify-center`}
            >
              {selectedFinding.severity.toUpperCase()}
            </span>
          </div>
        </div>
      </div>
      {summaryAction ? (
        <div
          className={`flex w-full shrink-0 items-start gap-3 rounded-xl border border-emerald-200/70 bg-gradient-to-b from-emerald-50/60 to-white px-4 py-3.5 shadow-sm shadow-zinc-950/[0.03] lg:w-[21rem] ${POSTURE_STRIP_MIN_H}`}
        >
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100/80 text-emerald-700">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700/80">
              Recommended action
            </p>
            <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-[13px] font-medium leading-snug text-zinc-900">
              {summaryAction}
            </p>
            <p className="mt-1 line-clamp-2 min-h-[2.25rem] text-[12px] leading-snug text-zinc-500">
              {summaryRisk || "\u00a0"}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatTimelineDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type ActivityMarker = {
  ts: string;
  kind: string;
  detail?: string | null;
  scan_run_id?: string | null;
};

type FindingActivity = {
  finding_id: string;
  status: string;
  first_seen: string;
  last_seen: string;
  open_days: number;
  markers: ActivityMarker[];
};

const OPEN_MARKER_KINDS = new Set(["opened", "reopened", "recheck_opened"]);
const STATUS_MARKER_KINDS = new Set(["resolved", "excepted", "ignored", "snoozed"]);

function activityStatusLine(
  finding: ResourcesTabFinding,
  openDays: number,
): { text: string; className: string } {
  if (finding.status === "open") {
    return { text: `Open for ${openDays} days`, className: "text-amber-600" };
  }
  if (finding.status === "resolved") {
    return { text: `Resolved after ${openDays} days`, className: "text-emerald-700" };
  }
  return { text: findingStatusLabel(finding.status), className: "text-zinc-700" };
}

function markerTooltip(kind: string): string {
  switch (kind) {
    case "opened":
      return "Finding opened";
    case "reopened":
    case "recheck_opened":
      return "Finding reopened";
    case "scan_open":
      return "Confirmed open on scan";
    case "resolved":
      return "Resolved";
    case "excepted":
      return "Risk accepted (exception)";
    case "ignored":
      return "Ignored";
    case "snoozed":
      return "Snoozed";
    default:
      return kind;
  }
}

function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  if (max <= 1) return [items[items.length - 1]!];
  const out: T[] = [];
  for (let i = 0; i < max; i += 1) {
    const idx = Math.round((i / (max - 1)) * (items.length - 1));
    out.push(items[idx]!);
  }
  return out;
}

type TimelineDot =
  | { kind: "origin"; ts: string; tooltip: string }
  | { kind: "scan"; ts: string; tooltip: string }
  | { kind: "status"; ts: string; tooltip: string; tone: "resolved" | "muted" }
  | { kind: "tail" };

function buildTimelineDots(activity: FindingActivity | undefined, fallbackFirstSeen: string): TimelineDot[] {
  if (!activity || activity.markers.length === 0) {
    const synthetic = Math.min(Math.max(openDaysSince(fallbackFirstSeen), 1), 11);
    const dots: TimelineDot[] = [{ kind: "origin", ts: fallbackFirstSeen, tooltip: "First seen" }];
    for (let i = 0; i < synthetic; i += 1) dots.push({ kind: "scan", ts: fallbackFirstSeen, tooltip: "Scan history unavailable" });
    dots.push({ kind: "tail" }, { kind: "tail" });
    return dots;
  }

  const markers = [...activity.markers].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );
  const origin =
    markers.find((m) => OPEN_MARKER_KINDS.has(m.kind)) ?? markers[0]!;
  const statusMarkers = markers.filter((m) => STATUS_MARKER_KINDS.has(m.kind));
  const scanMarkers = markers.filter((m) => m.kind === "scan_open");
  const sampledScans = sampleEvenly(scanMarkers, 11);

  const dots: TimelineDot[] = [
    { kind: "origin", ts: origin.ts, tooltip: markerTooltip(origin.kind) },
  ];

  for (const scan of sampledScans) {
    dots.push({
      kind: "scan",
      ts: scan.ts,
      tooltip: `${markerTooltip(scan.kind)} · ${formatTimelineDate(scan.ts)}`,
    });
  }

  const lastStatus = statusMarkers[statusMarkers.length - 1];
  if (lastStatus) {
    dots.push({
      kind: "status",
      ts: lastStatus.ts,
      tooltip: markerTooltip(lastStatus.kind),
      tone: lastStatus.kind === "resolved" ? "resolved" : "muted",
    });
  } else if (activity.status === "open") {
    dots.push({ kind: "tail" }, { kind: "tail" });
  }

  return dots;
}

function TimelineDotNode({ dot }: { dot: TimelineDot }) {
  if (dot.kind === "origin") {
    return (
      <span
        className="relative flex h-3 w-3 shrink-0 items-center justify-center"
        title={dot.tooltip}
        aria-label={dot.tooltip}
      >
        <span className="absolute h-5 w-5 rounded-full bg-red-400/30" />
        <span className="relative h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />
      </span>
    );
  }
  if (dot.kind === "scan") {
    return (
      <span
        className="h-2 w-2 shrink-0 rounded-full bg-amber-400 ring-2 ring-white"
        title={dot.tooltip}
        aria-label={dot.tooltip}
      />
    );
  }
  if (dot.kind === "status") {
    const color =
      dot.tone === "resolved"
        ? "bg-emerald-500"
        : "bg-zinc-400";
    return (
      <span
        className={`h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white ${color}`}
        title={dot.tooltip}
        aria-label={dot.tooltip}
      />
    );
  }
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300 ring-2 ring-white" aria-hidden />;
}

function segmentClass(before: TimelineDot, after: TimelineDot): string {
  if (before.kind === "tail" || after.kind === "tail") return "bg-zinc-200";
  if (after.kind === "status" && after.tone === "resolved") return "bg-emerald-300";
  if (before.kind === "status") return "bg-zinc-200";
  return "bg-amber-400";
}

function ResourcesActivityTimeline({
  selectedFinding,
}: {
  selectedFinding: ResourcesTabFinding;
}) {
  const { data: activity, isLoading } = useQuery({
    queryKey: ["finding-activity", selectedFinding.id],
    queryFn: () => api<FindingActivity>(`/v1/findings/${selectedFinding.id}/activity?days=90`),
    staleTime: 30_000,
  });

  const openDays = activity?.open_days ?? openDaysSince(selectedFinding.first_seen);
  const statusLine = activityStatusLine(selectedFinding, openDays);
  const dots = buildTimelineDots(activity, selectedFinding.first_seen);

  const datedDots = dots.filter((d): d is TimelineDot & { ts: string } => d.kind !== "tail");
  const firstLabel = formatTimelineDate(datedDots[0]?.ts ?? selectedFinding.first_seen);
  const lastDated = datedDots[datedDots.length - 1];
  const lastLabel = formatTimelineDate(lastDated?.ts ?? selectedFinding.last_seen);

  const tailCount = dots.filter((d) => d.kind === "tail").length;
  const activeEndPercent =
    dots.length <= 1
      ? 100
      : ((dots.length - tailCount) / dots.length) * 100;

  return (
    <div className="flex">
      <div className="flex w-[9.5rem] shrink-0 flex-col justify-center border-r border-zinc-100 px-4 py-3.5 sm:w-[10.5rem]">
        <p className="text-[12px] font-medium text-zinc-500">Latest activity</p>
        <p className={`mt-0.5 text-[15px] font-semibold leading-snug ${statusLine.className}`}>
          {isLoading ? "Loading…" : statusLine.text}
        </p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center px-4 py-3.5">
        <div className="relative mb-2 h-4">
          <span className="absolute left-0 top-0 text-[11px] tabular-nums text-zinc-400">{firstLabel}</span>
          <span
            className="absolute top-0 -translate-x-1/2 text-[11px] tabular-nums text-zinc-400"
            style={{ left: `${activeEndPercent}%` }}
          >
            {lastLabel}
          </span>
        </div>

        <div className="flex w-full items-center" aria-busy={isLoading}>
          {dots.map((dot, i) => (
            <span key={`${dot.kind}-${i}`} className="contents">
              {i > 0 ? (
                <span className={`h-[2px] min-w-[6px] flex-1 ${segmentClass(dots[i - 1]!, dot)}`} />
              ) : null}
              <TimelineDotNode dot={dot} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

type SortKey = "recent" | "first_seen" | "name";

type RefreshNote = {
  phase: "running" | "done" | "error";
  text: string;
  tone: "neutral" | "success" | "warning";
};

function refreshNoteClassName(tone: RefreshNote["tone"]): string {
  if (tone === "success") return "text-emerald-700";
  if (tone === "warning") return "text-amber-700";
  return "text-zinc-500";
}

function formatRefreshOutcome(resolved: number, stillOpen: number): RefreshNote {
  if (resolved > 0) {
    return {
      phase: "done",
      tone: "success",
      text: `Updated — ${resolved} resolved${stillOpen > 0 ? ` · ${stillOpen} still open` : ""}`,
    };
  }
  return {
    phase: "done",
    tone: "neutral",
    text: stillOpen > 0 ? `Updated — ${stillOpen} still open` : "Updated — no changes",
  };
}

function ActiveFilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-zinc-200 bg-white py-1.5 pl-2.5 pr-1 text-[12px] font-medium text-zinc-800">
      {label}
      <button
        type="button"
        aria-label={`Remove ${label} filter`}
        onClick={onRemove}
        className="rounded-full px-1 text-zinc-400 hover:text-zinc-600"
      >
        ×
      </button>
    </span>
  );
}

function TypeFilterMenu({
  open,
  types,
  query,
  selected,
  onQueryChange,
  onToggle,
  onClear,
}: {
  open: boolean;
  types: string[];
  query: string;
  selected: Set<string>;
  onQueryChange: (value: string) => void;
  onToggle: (type: string) => void;
  onClear: () => void;
}) {
  const q = query.trim().toLowerCase();
  const matches = q ? types.filter((t) => t.toLowerCase().includes(q)) : types;

  if (!open) return null;

  return (
    <div className="absolute right-0 top-full z-20 mt-1.5 w-[min(16rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg shadow-zinc-950/10">
      <div className="border-b border-zinc-100 p-2">
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Filter by type…"
          autoFocus
          className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[12px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-300"
        />
      </div>
      <ul className="max-h-48 overflow-y-auto py-1">
        {matches.length === 0 ? (
          <li className="px-3 py-2 text-[12px] text-zinc-500">No matching types</li>
        ) : (
          matches.map((type) => {
            const active = selected.has(type);
            return (
              <li key={type}>
                <button
                  type="button"
                  onClick={() => onToggle(type)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition hover:bg-zinc-50 ${
                    active ? "font-semibold text-sky-700" : "text-zinc-700"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border ${
                      active ? "border-sky-600 bg-sky-600" : "border-zinc-300 bg-white"
                    }`}
                    aria-hidden
                  >
                    {active ? (
                      <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none">
                        <path
                          d="M2.5 6.25 4.75 8.5 9.5 3.75"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </span>
                  {type}
                </button>
              </li>
            );
          })
        )}
      </ul>
      {selected.size > 0 ? (
        <div className="border-t border-zinc-100 p-2">
          <button
            type="button"
            onClick={onClear}
            className="w-full rounded-lg px-2 py-1.5 text-[12px] font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-800"
          >
            Clear all type filters
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ToolbarIconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function FindingResourcesTab({
  selectedFinding,
  groupFindings,
  onSelectFinding,
  summaryRisk,
  summaryAction,
}: {
  selectedFinding: ResourcesTabFinding;
  groupFindings: ResourcesTabFinding[];
  onSelectFinding?: (finding: ResourcesTabFinding) => void;
  summaryRisk?: string | null;
  summaryAction?: string | null;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusOpenOnly] = useState(true);
  const [selectedTypeFilters, setSelectedTypeFilters] = useState<Set<string>>(() => new Set());
  const [typeFilterOpen, setTypeFilterOpen] = useState(false);
  const [typeFilterQuery, setTypeFilterQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<RefreshNote | null>(null);
  const typeFilterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!refreshNote || refreshNote.phase !== "done") return;
    const dismissMs = refreshNote.tone === "warning" ? 30_000 : 12_000;
    const id = window.setTimeout(() => setRefreshNote(null), dismissMs);
    return () => window.clearTimeout(id);
  }, [refreshNote]);

  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    for (const f of groupFindings) {
      types.add(assetTypeLabel(f.check_id));
    }
    return [...types].sort((a, b) => a.localeCompare(b));
  }, [groupFindings]);

  useEffect(() => {
    if (!typeFilterOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!typeFilterRef.current?.contains(event.target as Node)) {
        setTypeFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [typeFilterOpen]);

  useEffect(() => {
    setSelectedTypeFilters((prev) => {
      const next = new Set([...prev].filter((t) => availableTypes.includes(t)));
      return next.size === prev.size ? prev : next;
    });
  }, [availableTypes]);

  const toggleTypeFilter = (type: string) => {
    setSelectedTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const removeTypeFilter = (type: string) => {
    setSelectedTypeFilters((prev) => {
      if (!prev.has(type)) return prev;
      const next = new Set(prev);
      next.delete(type);
      return next;
    });
  };

  const selectedTypeFilterList = useMemo(
    () => [...selectedTypeFilters].sort((a, b) => a.localeCompare(b)),
    [selectedTypeFilters],
  );

  const rows = useMemo(() => {
    const deduped = dedupeByArn(groupFindings);
    const q = search.trim().toLowerCase();
    let filtered = deduped.filter((f) => {
      if (statusOpenOnly && f.status !== "open") return false;
      if (
        selectedTypeFilters.size > 0 &&
        !selectedTypeFilters.has(assetTypeLabel(f.check_id))
      ) {
        return false;
      }
      if (!q) return true;
      const name = resourceDisplayName(f).toLowerCase();
      return name.includes(q) || f.resource_arn.toLowerCase().includes(q);
    });

    filtered = [...filtered].sort((a, b) => {
      if (sortKey === "name") {
        return resourceDisplayName(a).localeCompare(resourceDisplayName(b));
      }
      if (sortKey === "first_seen") {
        return new Date(a.first_seen).getTime() - new Date(b.first_seen).getTime();
      }
      return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime();
    });

    return filtered;
  }, [groupFindings, search, statusOpenOnly, selectedTypeFilters, sortKey]);

  const handleRowSelect = (finding: ResourcesTabFinding) => {
    onSelectFinding?.(finding);
  };

  async function invalidateFindingData() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["findings"] }),
      qc.invalidateQueries({ queryKey: ["controls"] }),
      qc.invalidateQueries({ queryKey: ["finding-activity"] }),
    ]);
    await qc.refetchQueries({ queryKey: ["findings"] });
  }

  function tallyBatchRecheck(
    results: RecheckBatchResponse["results"],
    tallies: { resolved: number; unchanged: number },
  ) {
    for (const result of results ?? []) {
      if (!result.checked) continue;
      if (result.resolved) tallies.resolved += 1;
      else tallies.unchanged += 1;
    }
  }

  async function refreshVisibleResources() {
    if (rows.length === 0 || refreshing) return;
    setRefreshing(true);
    setRefreshNote({ phase: "running", text: "Checking resources…", tone: "neutral" });

    const rowIds = rows.map((f) => f.id);
    const checkId = selectedFinding.check_id;
    const tallies = { resolved: 0, unchanged: 0 };

    try {
      const baseline = snapshotFindings(
        rows.map((f) => ({ id: f.id, status: f.status, last_seen: f.last_seen })),
        rowIds,
      );
      const queuedAtMs = Date.now();

      // One request: refresh each visible resource in AWS, run the check once, persist once.
      const batch = await api<RecheckBatchResponse>("/v1/findings/recheck-batch", {
        method: "POST",
        body: JSON.stringify({ finding_ids: rowIds }),
      });
      const queued = Boolean(batch.queued);

      if (queued) {
        setRefreshNote({ phase: "running", text: "Running full check…", tone: "neutral" });
      } else {
        tallyBatchRecheck(batch.results, tallies);
      }

      if (queued) {
        const outcome = await waitForRecheckUpdate(checkId, rowIds, baseline, queuedAtMs);
        await invalidateFindingData();
        const finalItems = await fetchCheckFindings(checkId);
        const { resolved, stillOpen } = summarizeRefreshOutcome(rowIds, baseline, finalItems);

        if (outcome === "timeout" && resolved === 0 && stillOpen === rowIds.length) {
          setRefreshNote({
            phase: "done",
            tone: "warning",
            text: "Check is still running — results will update when the worker finishes",
          });
        } else {
          setRefreshNote(formatRefreshOutcome(resolved, stillOpen));
        }
      } else {
        await invalidateFindingData();
        if (tallies.resolved > 0) {
          setRefreshNote(formatRefreshOutcome(tallies.resolved, tallies.unchanged));
        } else {
          setRefreshNote({
            phase: "done",
            tone: "neutral",
            text: `Checked ${rows.length} — still open`,
          });
        }
      }
    } catch {
      setRefreshNote({
        phase: "error",
        tone: "warning",
        text: "Could not refresh — try again",
      });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-3">
      <ResourcesPostureStrip
        selectedFinding={selectedFinding}
        groupFindings={groupFindings}
        summaryRisk={summaryRisk}
        summaryAction={summaryAction}
      />

      {/* Toolbar — separate controls on one line, no shared card */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-[10rem] max-w-[17rem] sm:max-w-[19rem]">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            viewBox="0 0 24 24"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search resources…"
            className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-[13px] text-zinc-800 shadow-sm shadow-zinc-950/[0.02] outline-none placeholder:text-zinc-400 focus:border-zinc-300"
          />
        </div>

        {selectedTypeFilterList.map((type) => (
          <ActiveFilterPill key={type} label={type} onRemove={() => removeTypeFilter(type)} />
        ))}

        <div className="relative shrink-0">
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label="Sort resources"
            className="appearance-none rounded-full border border-zinc-200 bg-white py-1.5 pl-3 pr-8 text-[12px] font-medium text-zinc-700 shadow-sm shadow-zinc-950/[0.02] outline-none focus:border-zinc-300"
          >
            <option value="recent">Recently seen</option>
            <option value="first_seen">First seen</option>
            <option value="name">Name</option>
          </select>
          <svg
            className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
          </svg>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {refreshNote ? (
            <p
              className={`max-w-[14rem] text-right text-[11px] font-medium leading-snug sm:max-w-[22rem] ${refreshNoteClassName(refreshNote.tone)}`}
              role="status"
              aria-live="polite"
            >
              {refreshNote.text}
            </p>
          ) : null}
          <ToolbarIconButton
            label="Refresh visible resources"
            disabled={refreshing || rows.length === 0}
            onClick={() => void refreshVisibleResources()}
          >
            {refreshing ? (
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
                />
              </svg>
            )}
          </ToolbarIconButton>
          <div ref={typeFilterRef} className="relative">
            <ToolbarIconButton
              label="Filter by type"
              onClick={() => {
                setTypeFilterOpen((open) => !open);
                setTypeFilterQuery("");
              }}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z"
                />
              </svg>
            </ToolbarIconButton>
            <TypeFilterMenu
              open={typeFilterOpen}
              types={availableTypes}
              query={typeFilterQuery}
              selected={selectedTypeFilters}
              onQueryChange={setTypeFilterQuery}
              onToggle={toggleTypeFilter}
              onClear={() => setSelectedTypeFilters(new Set())}
            />
          </div>
        </div>
      </div>

      {/* Resource list — single merged card, rows divided by lines */}
      <div className="overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-sm shadow-zinc-950/[0.03]">
        <div className="overflow-x-auto">
          <table className="min-w-[56rem] w-full border-collapse text-left">
            <colgroup>
              <col className="min-w-[14rem]" />
              <col className="w-[6.75rem]" />
              <col className="min-w-[7.5rem]" />
              <col />
              <col />
              <col className="min-w-[14rem]" />
            </colgroup>
            <thead>
              <tr className="border-b border-zinc-100 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                <th className="px-4 pb-2.5 pt-3 text-left align-bottom font-semibold">Resource</th>
                <th className="w-[1%] whitespace-nowrap px-4 pb-2.5 pt-3 text-left align-bottom font-semibold">
                  Type
                </th>
                <th className="px-4 pb-2.5 pt-3 text-left align-bottom font-semibold">Account</th>
                <th className="px-4 pb-2.5 pt-3 text-left align-bottom font-semibold">First seen</th>
                <th className="px-4 pb-2.5 pt-3 text-left align-bottom font-semibold">Last seen</th>
                <th className="px-4 pb-2.5 pt-3 text-left align-bottom font-semibold">
                  Why this resource is affected
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const name = resourceDisplayName(f);
                const accountName = findingScopeDisplayName(f) || "—";
                const accountAwsId = awsAccountIdFromFinding(f) ?? "—";
                const first = formatResourceTableDate(f.first_seen, "first");
                const last = formatResourceTableDate(f.last_seen, "last");
                const rowAssetType = assetTypeLabel(f.check_id);
                const isSelected = f.id === selectedFinding.id;
                const rowBg = isSelected
                  ? "bg-indigo-50/55"
                  : "bg-white group-hover:bg-zinc-50/60";

                return (
                  <tr
                    key={f.id}
                    role="button"
                    tabIndex={0}
                    aria-selected={isSelected}
                    onClick={() => handleRowSelect(f)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleRowSelect(f);
                      }
                    }}
                    className={`group cursor-pointer border-b border-zinc-100 transition-colors last:border-b-0 ${rowBg}`}
                  >
                    <td className="px-4 py-4 align-middle">
                      <div className="flex items-center gap-3">
                        <CloudProviderMark finding={f} />
                        <div className="min-w-0 max-w-[20rem]">
                          <p
                            className="truncate text-[13px] font-semibold leading-tight text-zinc-900"
                            title={name}
                          >
                            {truncateDisplayText(name, RESOURCE_NAME_DISPLAY_MAX)}
                          </p>
                          <p className="mt-1 inline-flex max-w-full items-center gap-1.5 font-mono text-[11px] leading-4 text-zinc-500">
                            <span className="truncate" title={f.resource_arn}>
                              {truncateArnDisplay(f.resource_arn)}
                            </span>
                            <CopyArnButton arn={f.resource_arn} />
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="w-[1%] whitespace-nowrap px-4 py-4 align-middle">
                      <div>
                        <ResourceTypePill label={rowAssetType} />
                        {/* phantom sub-line — keeps the pill level with the first line of the
                            two-line cells (name/ARN, alias/ID), which all share this geometry */}
                        <div className="mt-1 h-4" aria-hidden />
                      </div>
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <p className="truncate text-[12px] font-medium leading-tight text-zinc-800">{accountName}</p>
                      <p className="mt-1 whitespace-nowrap font-mono text-[11px] leading-4 tabular-nums text-zinc-500">
                        {accountAwsId}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 align-middle">
                      <p className="text-[12px] font-medium leading-tight tabular-nums text-zinc-800">
                        {first.primary}
                      </p>
                      <p className="mt-1 text-[11px] leading-4 text-zinc-500">{first.sub}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 align-middle">
                      <p className="text-[12px] font-medium leading-tight tabular-nums text-zinc-800">
                        {last.primary}
                      </p>
                      <p className="mt-1 text-[11px] leading-4 text-zinc-500">{last.sub}</p>
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <ResourceWhyAffectedCompact finding={f} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? (
          <p className="border-t border-zinc-100 py-10 text-center text-[12px] text-zinc-500">
            No resources match your filters.
          </p>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-sm shadow-zinc-950/[0.03]">
        <ResourcesActivityTimeline selectedFinding={selectedFinding} />
      </div>
    </div>
  );
}
