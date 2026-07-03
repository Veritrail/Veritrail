import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import {
  assetTypeLabel,
  awsAccountIdFromFinding,
  daysAgo,
  findingScopeDisplayName,
  resourceDisplayName,
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
import "../styles/finding-resources-tab.css";

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

/** Grouped findings (e.g. encryption at rest) span multiple check_ids — recheck-batch requires one per call. */
function groupRowsByCheckId(rows: ResourcesTabFinding[]): Map<string, ResourcesTabFinding[]> {
  const map = new Map<string, ResourcesTabFinding[]>();
  for (const row of rows) {
    const list = map.get(row.check_id) ?? [];
    list.push(row);
    map.set(row.check_id, list);
  }
  return map;
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
/** Visible ARN chars before "..." — keeps copy clear of the Type pill. */
const RESOURCE_ARN_VISUAL_MAX = 32;
/** Fixed slot width (ch) — must stay at 36 so the column layout does not shift. */
const RESOURCE_ARN_SLOT_CH = 36;

function truncateDisplayText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function truncateArnDisplay(arn: string, max = RESOURCE_ARN_VISUAL_MAX): string {
  const trimmed = arn.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 3)}...`;
}

function ResourceTypePill({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 whitespace-nowrap rounded-full bg-sky-50 px-2.5 py-1 text-[12px] font-semibold leading-none text-sky-700">
      {label}
    </span>
  );
}

function CopyTextButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1000);
        });
      }}
      className={`shrink-0 transition focus:outline-none ${
        copied ? "text-emerald-600" : "text-zinc-400 hover:text-zinc-600"
      }`}
    >
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
      {copied ? (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
          <rect x="3" y="2" width="13" height="16" rx="2.5" />
          <path d="M16 6h2.5A2.5 2.5 0 0 1 21 8.5v11a2.5 2.5 0 0 1-2.5 2.5h-10A2.5 2.5 0 0 1 6 19.5V18" />
        </svg>
      )}
    </button>
  );
}

function CopyArnButton({ arn }: { arn: string }) {
  return <CopyTextButton text={arn} label="Copy resource ARN" />;
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

function RecommendedActionMark({ className }: { className?: string }) {
  return (
    <img
      src="/icons/recommended-action.png"
      alt=""
      aria-hidden
      className={className}
    />
  );
}

function ResourcesPostureStrip({
  selectedFinding,
  groupFindings,
  summaryRisk,
  summaryAction,
  onViewRemediation,
}: {
  selectedFinding: ResourcesTabFinding;
  groupFindings: ResourcesTabFinding[];
  summaryRisk?: string | null;
  summaryAction?: string | null;
  onViewRemediation?: () => void;
}) {
  const unique = dedupeByArn(groupFindings);
  const scoreTone = riskScoreTone(selectedFinding.severity);

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
      <div className="grid w-full shrink-0 grid-cols-2 divide-x divide-zinc-100 rounded-xl border border-zinc-200/90 bg-white shadow-sm shadow-zinc-950/[0.03] lg:w-[16.5rem]">
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-5 text-center">
          <p className="whitespace-nowrap text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            Resources
          </p>
          <p className="text-[26px] font-bold leading-none tabular-nums text-zinc-900">{unique.length}</p>
        </div>
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-5 text-center">
          <p className="whitespace-nowrap text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            Risk score
          </p>
          <p className={`text-[26px] font-bold leading-none tabular-nums ${scoreTone}`}>
            {selectedFinding.risk_score}
          </p>
        </div>
      </div>

      {summaryAction ? (
        <div className="flex w-full min-w-0 flex-1 items-start gap-4 rounded-xl border border-emerald-200/70 bg-gradient-to-b from-emerald-50/70 to-white p-5 shadow-sm shadow-zinc-950/[0.03] lg:min-w-[18rem]">
          <RecommendedActionMark className="h-24 w-24 shrink-0 sm:h-28 sm:w-28" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-emerald-700/85">
              Recommended action
            </p>
            <p className="mt-1.5 text-[15px] font-semibold leading-relaxed text-zinc-900">{summaryAction}</p>
            {summaryRisk ? (
              <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">{summaryRisk}</p>
            ) : null}
            {onViewRemediation ? (
              <button
                type="button"
                onClick={onViewRemediation}
                className="-ml-0.5 mt-4 text-[13px] font-semibold text-emerald-700 transition hover:text-emerald-800"
              >
                View remediation guidance →
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
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

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function csvRow(cells: string[]): string {
  return cells.map(escapeCsvCell).join(",");
}

function downloadCsvFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function findingResourcesCsvFilename(finding: ResourcesTabFinding): string {
  const slug = finding.check_id || finding.id;
  const date = new Date().toISOString().slice(0, 10);
  return `finding-resources-${slug}-${date}.csv`;
}

function buildFindingResourcesCsv(rows: ResourcesTabFinding[]): string {
  const header = csvRow([
    "Resource",
    "ARN",
    "Type",
    "Account",
    "Account ID",
    "First seen",
    "Last seen",
    "Why this resource is affected",
  ]);
  const body = rows.map((f) => {
    const name = resourceDisplayName(f);
    const accountName = findingScopeDisplayName(f) || "—";
    const accountAwsId = awsAccountIdFromFinding(f) ?? "—";
    const first = formatResourceTableDate(f.first_seen, "first");
    const last = formatResourceTableDate(f.last_seen, "last");
    const firstSeen = first.sub ? `${first.primary} (${first.sub})` : first.primary;
    const lastSeen = last.sub ? `${last.primary} (${last.sub})` : last.primary;
    return csvRow([
      name,
      f.resource_arn,
      assetTypeLabel(f.check_id),
      accountName,
      accountAwsId,
      firstSeen,
      lastSeen,
      resourceAffectedReason(f),
    ]);
  });
  return [header, ...body].join("\n");
}

export function FindingResourcesTab({
  selectedFinding,
  groupFindings,
  onSelectFinding,
  summaryRisk,
  summaryAction,
  onViewRemediation,
}: {
  selectedFinding: ResourcesTabFinding;
  groupFindings: ResourcesTabFinding[];
  onSelectFinding?: (finding: ResourcesTabFinding) => void;
  summaryRisk?: string | null;
  summaryAction?: string | null;
  onViewRemediation?: () => void;
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

  function downloadVisibleResourcesCsv() {
    if (rows.length === 0) return;
    const csv = buildFindingResourcesCsv(rows);
    downloadCsvFile(csv, findingResourcesCsvFilename(selectedFinding));
  }

  async function refreshVisibleResources() {
    if (rows.length === 0 || refreshing) return;
    setRefreshing(true);
    setRefreshNote({ phase: "running", text: "Checking resources…", tone: "neutral" });

    const rowIds = rows.map((f) => f.id);
    const checkGroups = groupRowsByCheckId(rows);
    const tallies = { resolved: 0, unchanged: 0 };

    try {
      const baseline = snapshotFindings(
        rows.map((f) => ({ id: f.id, status: f.status, last_seen: f.last_seen })),
        rowIds,
      );
      const queuedAtMs = Date.now();
      const queuedGroups: { checkId: string; ids: string[] }[] = [];

      for (const [checkId, groupRows] of checkGroups) {
        const groupIds = groupRows.map((f) => f.id);
        const batch = await api<RecheckBatchResponse>("/v1/findings/recheck-batch", {
          method: "POST",
          body: JSON.stringify({ finding_ids: groupIds }),
        });
        if (batch.queued) {
          queuedGroups.push({ checkId, ids: groupIds });
        } else {
          tallyBatchRecheck(batch.results, tallies);
        }
      }

      if (queuedGroups.length > 0) {
        setRefreshNote({ phase: "running", text: "Running full check…", tone: "neutral" });
        const outcomes = await Promise.all(
          queuedGroups.map(({ checkId, ids }) =>
            waitForRecheckUpdate(checkId, ids, baseline, queuedAtMs),
          ),
        );
        await invalidateFindingData();

        let resolved = 0;
        let stillOpen = 0;
        for (const [checkId, groupRows] of checkGroups) {
          const groupIds = groupRows.map((f) => f.id);
          const finalItems = await fetchCheckFindings(checkId);
          const part = summarizeRefreshOutcome(groupIds, baseline, finalItems);
          resolved += part.resolved;
          stillOpen += part.stillOpen;
        }

        const allTimedOut = outcomes.every((o) => o === "timeout");
        if (allTimedOut && resolved === 0 && stillOpen === rowIds.length) {
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
    <div className="finding-resources-tab space-y-3">
      <ResourcesPostureStrip
        selectedFinding={selectedFinding}
        groupFindings={groupFindings}
        summaryRisk={summaryRisk}
        summaryAction={summaryAction}
        onViewRemediation={onViewRemediation}
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
          <ToolbarIconButton
            label="Download visible resources as CSV"
            disabled={rows.length === 0}
            onClick={downloadVisibleResourcesCsv}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
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
          <table className="finding-resources-tab__table min-w-[56rem] w-full border-collapse text-left">
            <colgroup>
              <col className="min-w-[14rem]" />
              <col className="finding-resources-tab__type-col min-w-[10rem]" />
              <col className="min-w-[7.5rem]" />
              <col />
              <col />
              <col className="min-w-[14rem]" />
            </colgroup>
            <thead>
              <tr className="border-b border-zinc-100 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                <th className="px-4 pb-2.5 pt-3 text-left align-bottom font-semibold">Resource</th>
                <th className="finding-resources-tab__type-head w-[1%] whitespace-nowrap pl-2 pr-6 pb-2.5 pt-3 text-left align-bottom font-semibold">
                  <span className="inline-block -translate-x-8">Type</span>
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
                  ? "bg-gradient-to-r from-indigo-50 via-indigo-50/45 to-transparent shadow-[inset_3px_0_0_0_theme(colors.indigo.500),inset_0_0_0_1px_theme(colors.indigo.100)]"
                  : "bg-white hover:bg-indigo-50/40 hover:shadow-[inset_0_0_0_1px_rgba(99,102,241,0.14)]";

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
                    className={`group cursor-pointer border-b border-zinc-100 transition-[background-color,box-shadow] duration-150 last:border-b-0 ${rowBg}`}
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
                          <p
                            className="mt-1 flex items-center font-mono text-[11px] leading-4 text-zinc-500"
                            style={{ minWidth: `${RESOURCE_ARN_SLOT_CH}ch` }}
                          >
                            <span
                              className="inline-flex items-center gap-1 whitespace-nowrap"
                              title={f.resource_arn}
                            >
                              <span>{truncateArnDisplay(f.resource_arn)}</span>
                              <span className="opacity-0 transition-opacity group-hover:opacity-100">
                                <CopyArnButton arn={f.resource_arn} />
                              </span>
                            </span>
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="finding-resources-tab__type-cell w-[1%] whitespace-nowrap pl-2 pr-6 py-4 align-middle">
                      <div className="flex -translate-x-8 flex-col items-start">
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
    </div>
  );
}
