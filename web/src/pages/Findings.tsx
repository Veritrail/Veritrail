import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AccountSelect } from "../components/AccountSelect";
import {
  BenchmarkFrameworkSelect,
  benchmarkSelectionLabel,
  parseFrameworkParam,
  serializeFrameworkParam,
} from "../components/BenchmarkFrameworkSelect";
import { FindingsStatusSelect } from "../components/FindingsStatusSelect";
import { api, token } from "../api";
import ConnectAwsEmptyState from "../components/ConnectAwsEmptyState";
import NotificationsBell from "../components/NotificationsBell";
import ScanProgressBar from "../components/ScanProgressBar";
import { FindingDrawer, defaultFindingRemediationMode, type FindingDrawerTab, type FindingRemediationMode } from "../components/FindingDrawer";
import { checkLabels } from "../data/checkLabels";
import { CHECK_FRAMEWORK_MAP } from "../data/checkFrameworkMap";
import type { FrameworkId } from "../data/frameworks";
import { resourceDisplayName as shortArn } from "../lib/timelineDisplay";
import { severityLabel } from "../lib/findingDisplay";
import { isAccountConnected } from "../lib/accountConnection";
import { useTriggeredScan } from "../hooks/useTriggeredScan";
import { useRecheckNotifications, type RecheckResponse } from "../context/RecheckNotificationsContext";
import "../styles/findings-v2.css";

type Finding = {
  id: string;
  account_id?: string;
  check_id: string;
  resource_arn: string;
  title: string;
  severity: string;
  risk_score: number;
  status: string;
  evidence: Record<string, unknown>;
  first_seen: string;
  last_seen: string;
  exception_reason?: string | null;
  exception_approved_by?: string | null;
  exception_expires_at?: string | null;
};

type FindingPage = { items: Finding[]; total: number; next_cursor: string | null };
type Account = {
  id: string;
  label?: string | null;
  status: string;
  account_id: string | null;
  last_scan_at?: string | null;
  cfn_launch_url?: string;
};
type StatusTab = "open" | "excepted" | "resolved" | "all";
type SeverityFilter = "all" | "critical" | "high" | "medium" | "low" | "info";

const severityTabs: { id: SeverityFilter; label: string; urgent?: boolean }[] = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical", urgent: true },
  { id: "high", label: "High", urgent: true },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
  { id: "info", label: "Info" },
];
type SortKey = "severity" | "score" | "first_seen";

const sevWeight: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "severity", label: "Severity" },
  { id: "score", label: "Risk" },
  { id: "first_seen", label: "Age" },
];


function emptyFindingsLabel(status: StatusTab): string {
  if (status === "all") return "No findings";
  if (status === "excepted") return "No exceptions";
  return `No ${status} findings`;
}

function FindingsScanButton({
  connectedId,
  isRunning,
  scanTriggered,
  onScan,
}: {
  connectedId: string;
  isRunning: boolean;
  scanTriggered: boolean;
  onScan: (accountId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onScan(connectedId)}
      disabled={scanTriggered || isRunning}
      className="findings-v2-toolbar-btn findings-v2-toolbar-btn--scan"
    >
      {isRunning ? "Scanning…" : scanTriggered ? "Starting…" : "Scan"}
    </button>
  );
}

function matchesSeverityFilter(f: Finding, filter: SeverityFilter): boolean {
  if (filter === "all") return true;
  return f.severity === filter;
}

function frameworksForCheck(checkId: string, apiMap: Record<string, string[]> | undefined): string[] {
  return apiMap?.[checkId] ?? CHECK_FRAMEWORK_MAP[checkId] ?? [];
}

function matchesBenchmarkFilter(
  f: Finding,
  selected: FrameworkId[],
  apiMap: Record<string, string[]> | undefined,
): boolean {
  if (selected.length === 0) return true;
  const fws = frameworksForCheck(f.check_id, apiMap);
  return selected.some((id) => fws.includes(id));
}

function SeverityIndicator({ severity }: { severity: string }) {
  const badgeClass =
    "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium";
  if (severity === "critical") {
    return (
      <span className={`${badgeClass} bg-red-50 text-red-800 ring-1 ring-red-300/70`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" aria-hidden />
        Critical
      </span>
    );
  }
  if (severity === "high") {
    return (
      <span className={`${badgeClass} bg-red-50/85 text-red-700 ring-1 ring-red-200/65`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500/80" aria-hidden />
        High
      </span>
    );
  }
  if (severity === "medium") {
    return (
      <span className={`${badgeClass} bg-amber-50/90 text-amber-800 ring-1 ring-amber-200/70`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/85" aria-hidden />
        Medium
      </span>
    );
  }
  return (
    <span className={`${badgeClass} bg-zinc-100/90 text-zinc-500 ring-1 ring-zinc-200/70`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400/70" aria-hidden />
      Low
    </span>
  );
}

function RiskScoreDisplay({ score, severity }: { score: number; severity: string }) {
  const styles =
    severity === "critical"
      ? "bg-red-50 text-red-800 border-red-500 ring-red-200/70"
      : severity === "high"
        ? "bg-red-50/90 text-red-700 border-red-400 ring-red-200/60"
        : severity === "medium"
          ? "bg-amber-50 text-amber-800 border-amber-400 ring-amber-200/70"
          : "bg-slate-50 text-slate-600 border-slate-300 ring-slate-200/70";

  return (
    <span
      aria-label={`Risk score ${score}`}
      className={`inline-flex h-7 w-14 items-center justify-center rounded-md border-l-[3px] text-sm font-bold tabular-nums leading-none shadow-sm shadow-zinc-950/[0.04] ring-1 ${styles}`}
    >
      {score}
    </span>
  );
}

/** arn:...:role/Foo -> Foo, arn:aws:s3:::my-bucket -> my-bucket (last path/colon segment). */
function shortResourceName(label: string): string {
  const afterSlash = label.split("/").pop() ?? label;
  const afterColon = afterSlash.split(":").pop() ?? afterSlash;
  return afterColon || label;
}

type ResourceOption = {
  key: string;
  label: string;
  finding: Finding;
};

function ResourcePicker({
  options,
  onSelect,
}: {
  options: ResourceOption[];
  onSelect: (finding: Finding) => void;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (pickerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (options.length === 0) return null;

  const summary = `${options.length} resource${options.length === 1 ? "" : "s"}`;

  return (
    <div
      ref={pickerRef}
      className="relative mt-1.5 inline-flex max-w-full align-top"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={`inline-flex max-w-[17rem] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-semibold leading-none transition-colors ${
          open
            ? "border-indigo-200 bg-indigo-50/70 text-indigo-700"
            : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={options.length === 1 ? options[0].label : "Select resource"}
      >
        <svg className="h-3.5 w-3.5 shrink-0 opacity-70" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75 12 3l8.25 3.75L12 10.5 3.75 6.75Zm0 5.25L12 15.75l8.25-3.75M3.75 17.25 12 21l8.25-3.75" />
        </svg>
        <span className="truncate">{summary}</span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-xl shadow-zinc-900/[0.12] ring-1 ring-zinc-950/[0.02]"
          role="menu"
          aria-label="Resources"
        >
          <div className="border-b border-zinc-100 bg-zinc-50/70 px-3.5 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              {options.length === 1 ? "Resource" : `${options.length} resources`}
            </span>
          </div>
          <div className="max-h-72 overflow-auto p-1.5">
            {options.map((option) => {
              const shortName = shortResourceName(option.label);
              const showArn = shortName !== option.label;
              return (
                <button
                  key={option.key}
                  type="button"
                  role="menuitem"
                  className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-zinc-50"
                  title={option.label}
                  onClick={() => {
                    setOpen(false);
                    onSelect(option.finding);
                  }}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400 transition-colors group-hover:bg-indigo-50 group-hover:text-indigo-500">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75 12 3l8.25 3.75L12 10.5 3.75 6.75Zm0 5.25L12 15.75l8.25-3.75M3.75 17.25 12 21l8.25-3.75" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13px] font-semibold text-zinc-900 ${showArn ? "" : "font-mono"}`}>
                      {shortName}
                    </span>
                    {showArn && (
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-zinc-400">{option.label}</span>
                    )}
                  </span>
                  <svg className="h-4 w-4 shrink-0 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function FindingRow({
  checkId,
  items,
  onReview,
}: {
  checkId: string;
  items: Finding[];
  onReview: (items: Finding[]) => void;
}) {
  const sev = items[0]?.severity ?? "low";
  const title = checkLabels[checkId] ?? items[0]?.title ?? checkId;
  const topRisk = Math.max(...items.map((f) => f.risk_score));
  const resources = useMemo<ResourceOption[]>(() => {
    const seen = new Set<string>();
    return items.flatMap((finding) => {
      const label = shortArn(finding.resource_arn);
      if (seen.has(label)) return [];
      seen.add(label);
      return [{ key: `${finding.id}:${label}`, label, finding }];
    });
  }, [items]);
  const railClass =
    sev === "critical" || sev === "high" || sev === "medium" || sev === "low"
      ? `findings-v2-row--${sev}`
      : "findings-v2-row--low";
  const openGroup = () => onReview(items);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openGroup}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openGroup();
        }
      }}
      aria-label={`Review ${title}, ${severityLabel(sev)}`}
      className={`findings-v2-row ${railClass} group grid w-full grid-cols-1 gap-3 py-2.5 pl-4 pr-4 last:rounded-b-2xl sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:items-center sm:gap-4`}
    >
      <div className="hidden w-5 shrink-0 items-center justify-center sm:flex">
        <svg
          className="h-3.5 w-3.5 text-[var(--chevron)] transition group-hover:translate-x-0.5 group-hover:text-[var(--chevron-hover)]"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
      </div>

      <div className="sm:w-[5.5rem] shrink-0">
        <SeverityIndicator severity={sev} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold leading-snug tracking-[-0.01em] text-[#111827]">{title}</p>
        <ResourcePicker options={resources} onSelect={(finding) => onReview([finding])} />
      </div>

      <div className="flex shrink-0 items-center justify-start sm:w-16 sm:justify-center">
        <RiskScoreDisplay score={topRisk} severity={sev} />
      </div>
    </div>
  );
}

export default function Findings() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusTab>("open");
  const [selected, setSelected] = useState<Finding | null>(null);
  const [drawerTab, setDrawerTab] = useState<FindingDrawerTab>("overview");
  const [remTab, setRemTab] = useState<FindingRemediationMode>("console");
  const [sortKey, setSortKey] = useState<SortKey>("severity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [searchText, setSearchText] = useState(searchParams.get("q") ?? "");
  const [searchTags, setSearchTags] = useState<string[]>(() => {
    const raw = searchParams.get("checks");
    return raw ? raw.split(",").filter(Boolean) : [];
  });
  const [selectedFrameworks, setSelectedFrameworks] = useState<FrameworkId[]>(() =>
    parseFrameworkParam(searchParams.get("framework")),
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState(searchParams.get("account") ?? "");
  const { pendingRecheck, recheckOutcome, startRecheck, applyRecheckResult, failRecheck, reportScanFailure, clearDrawerVerifyFlash } =
    useRecheckNotifications();
  const lastScanFailureKeyRef = useRef("");

  const frameworkMapQ = useQuery({
    queryKey: ["check-frameworks"],
    queryFn: () => api<{ checks: Record<string, string[]> }>("/v1/controls/check-frameworks"),
    staleTime: 300_000,
  });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/v1/accounts") });
  const connectedAccounts = useMemo(
    () => accounts.data?.filter((a) => isAccountConnected(a)) ?? [],
    [accounts.data],
  );
  const effectiveAccountId =
    (selectedAccountId && connectedAccounts.some((a) => a.id === selectedAccountId)
      ? selectedAccountId
      : connectedAccounts[0]?.id) || "";
  const connectedId = effectiveAccountId || undefined;

  const q = useQuery({
    queryKey: ["findings", status, effectiveAccountId],
    queryFn: () =>
      api<FindingPage>(
        `/v1/findings?status=${status}&limit=500${effectiveAccountId ? `&account_id=${effectiveAccountId}` : ""}`,
      ),
    refetchInterval: pendingRecheck ? 3000 : false,
  });
  const { scanRun, scanStatus, isRunning, scanTriggered, isScanActive, scanProgress, triggerScan } = useTriggeredScan(
    connectedId,
    { onScanComplete: () => qc.invalidateQueries({ queryKey: ["findings"] }) },
  );

  useEffect(() => {
    if (!(scanStatus === "error" && scanRun.data?.error)) return;
    const failureKey = `${connectedId ?? "unknown"}:${scanRun.data.failed_at ?? ""}:${scanRun.data.error_type ?? ""}:${scanRun.data.error}`;
    if (lastScanFailureKeyRef.current === failureKey) return;
    lastScanFailureKeyRef.current = failureKey;
    reportScanFailure({
      accountId: connectedId ?? null,
      message: scanRun.data.error,
      failedAt: scanRun.data.failed_at ?? null,
      errorType: scanRun.data.error_type ?? null,
      step: null,
    });
  }, [connectedId, scanRun.data, scanStatus, reportScanFailure]);

  useEffect(() => {
    if (isRefreshing && !q.isFetching) {
      const t = setTimeout(() => setIsRefreshing(false), 600);
      return () => clearTimeout(t);
    }
  }, [q.isFetching, isRefreshing]);

  useEffect(() => {
    const raw = searchParams.get("checks");
    const next = raw ? raw.split(",").filter(Boolean) : [];
    setSearchTags(next);
    if (next.length > 0) setStatus("open");
  }, [searchParams]);

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "recheck" | "reopen" }) =>
      api(`/v1/findings/${id}/${action}`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: (data, { id, action }) => {
      if (action === "recheck") {
        const result = data as RecheckResponse;
        const checkId = selected?.check_id ?? result.check_id ?? "";
        if (!applyRecheckResult(id, checkId, result)) setTimeout(() => qc.invalidateQueries({ queryKey: ["findings"] }), 6000);
      } else {
        qc.invalidateQueries({ queryKey: ["findings"] });
        if (selected) setSelected(data as Finding);
        if (action === "reopen") {
          clearDrawerVerifyFlash();
          setStatus("open");
        }
      }
    },
    onError: (_err, { id, action }) => {
      if (action === "recheck" && selected) failRecheck(id, selected.check_id);
    },
  });

  const findings = q.data?.items ?? [];
  const checkFrameworksApi = frameworkMapQ.data?.checks;
  const verifying = !!(selected && pendingRecheck?.findingId === selected.id);
  const verified = !!(selected && recheckOutcome?.findingId === selected.id && recheckOutcome.status === "verified");
  const verifyUnchanged = !!(selected && recheckOutcome?.findingId === selected.id && recheckOutcome.status === "unchanged");

  const benchmarkScopedFindings = useMemo(
    () => findings.filter((f) => matchesBenchmarkFilter(f, selectedFrameworks, checkFrameworksApi)),
    [findings, selectedFrameworks, checkFrameworksApi],
  );

  const rows = useMemo(() => {
    const qtext = searchText.trim().toLowerCase();
    const arr = benchmarkScopedFindings.filter((f) => {
      if (!matchesSeverityFilter(f, severityFilter)) return false;
      if (searchTags.length > 0) {
        const matchesCheck = searchTags.some((tag) => {
          if (f.check_id === tag) return true;
          const haystack = [f.title, f.check_id, f.resource_arn, checkLabels[f.check_id] ?? ""].join(" ").toLowerCase();
          return haystack.includes(tag.toLowerCase());
        });
        if (!matchesCheck) return false;
      }
      if (!qtext) return true;
      return [f.title, f.check_id, f.resource_arn, checkLabels[f.check_id] ?? ""].join(" ").toLowerCase().includes(qtext);
    });
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "severity") cmp = (sevWeight[a.severity] ?? 9) - (sevWeight[b.severity] ?? 9) || b.risk_score - a.risk_score;
      else if (sortKey === "score") cmp = b.risk_score - a.risk_score;
      else cmp = new Date(b.first_seen).getTime() - new Date(a.first_seen).getTime();
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [benchmarkScopedFindings, searchText, searchTags, severityFilter, sortKey, sortDir, status]);

  const displayGroups = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const f of rows) map.set(f.check_id, [...(map.get(f.check_id) ?? []), f]);
    const entries = [...map.entries()];
    entries.sort(([, a], [, b]) => {
      let cmp = 0;
      if (sortKey === "severity")
        cmp =
          (sevWeight[a[0].severity] ?? 9) - (sevWeight[b[0].severity] ?? 9) ||
          Math.max(...b.map((f) => f.risk_score)) - Math.max(...a.map((f) => f.risk_score));
      else if (sortKey === "score") cmp = Math.max(...b.map((f) => f.risk_score)) - Math.max(...a.map((f) => f.risk_score));
      else
        cmp =
          Math.min(...b.map((f) => new Date(f.first_seen).getTime())) -
          Math.min(...a.map((f) => new Date(f.first_seen).getTime()));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return entries;
  }, [rows, sortKey, sortDir]);

  const severityCounts = useMemo(() => {
    const counts = { all: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of benchmarkScopedFindings) {
      counts.all += 1;
      if (f.severity === "critical") counts.critical += 1;
      else if (f.severity === "high") counts.high += 1;
      else if (f.severity === "medium") counts.medium += 1;
      else if (f.severity === "low") counts.low += 1;
      else if (f.severity === "info") counts.info += 1;
    }
    return counts;
  }, [benchmarkScopedFindings]);

  function openReview(items: Finding[]) {
    const top = items.reduce((best, f) => (f.risk_score > best.risk_score ? f : best), items[0]);
    setSelected(top);
    setDrawerTab("overview");
    setRemTab(defaultFindingRemediationMode(top.check_id));
    clearDrawerVerifyFlash();
  }

  function handleBenchmarkChange(next: FrameworkId[]) {
    setSelectedFrameworks(next);
    const serialized = serializeFrameworkParam(next);
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (serialized) params.set("framework", serialized);
        else params.delete("framework");
        return params;
      },
      { replace: true },
    );
  }

  function handleAccountChange(id: string) {
    setSelectedAccountId(id);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set("account", id);
        else next.delete("account");
        return next;
      },
      { replace: true },
    );
  }

  function handleSearch(value: string) {
    setSearchText(value);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value.trim()) next.set("q", value.trim());
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  }

  function handleTagsChange(tags: string[]) {
    setSearchTags(tags);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tags.length > 0) next.set("checks", tags.join(","));
        else next.delete("checks");
        return next;
      },
      { replace: true },
    );
  }

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "severity" ? "asc" : "desc");
    }
  }

  const downloadCsv = useCallback(async () => {
    const BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:8000";
    const t = token();
    const res = await fetch(`${BASE}/v1/exports/findings.csv?status=${status}`, {
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vigil-findings.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [status]);

  if (!accounts.isLoading && accounts.data && !connectedId) return <ConnectAwsEmptyState />;

  return (
    <div className="findings-v2-page findings-v2-shell min-h-full">
      <div className="w-full px-8 py-8">
        <header className="mb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-[#111827]">Findings</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {connectedAccounts.length > 0 && (
                  <AccountSelect accounts={connectedAccounts} value={effectiveAccountId} onChange={handleAccountChange} />
                )}
              </div>
            </div>
            <NotificationsBell />
          </div>
        </header>

        {isScanActive && (
          <ScanProgressBar
            phase={isRunning ? "running" : "starting"}
            progress={scanProgress.progress}
            elapsedMs={scanProgress.elapsedMs}
            remainingMs={scanProgress.remainingMs}
            finishing={scanProgress.finishing}
            indeterminate={scanProgress.indeterminate}
            progressStep={scanProgress.progressStep}
            progressTotal={scanProgress.progressTotal}
          />
        )}

        {searchTags.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-zinc-500">Check filter</span>
            {searchTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 shadow-sm"
              >
                <span className="truncate">{checkLabels[tag] ?? tag}</span>
                <button
                  type="button"
                  className="text-zinc-400 hover:text-zinc-700"
                  aria-label={`Remove ${checkLabels[tag] ?? tag} filter`}
                  onClick={() => handleTagsChange(searchTags.filter((t) => t !== tag))}
                >
                  ×
                </button>
              </span>
            ))}
            <button type="button" onClick={() => handleTagsChange([])} className="text-xs font-semibold text-zinc-500 hover:text-indigo-700">
              Clear all
            </button>
          </div>
        )}

        {q.isLoading && <div className="py-16 text-center text-sm text-zinc-500">Loading…</div>}

        {!q.isLoading && (
          <section className="min-w-0">
            <div className="rounded-2xl border border-[#e6ebf2] bg-white shadow-sm shadow-zinc-950/[0.04]">
              <div className="findings-v2-table-toolbar">
                <div className="findings-v2-filter-cluster">
                  <div
                    className="inline-flex flex-wrap items-center gap-0.5 rounded-full border border-zinc-200/90 bg-zinc-100/70 p-1"
                    role="tablist"
                    aria-label="Severity"
                  >
                    {severityTabs.map((tab) => {
                      const isSelected = severityFilter === tab.id;
                      const count = severityCounts[tab.id];
                      const showUrgent = tab.urgent && count > 0;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={isSelected}
                          onClick={() => setSeverityFilter(tab.id)}
                          className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all ${
                            isSelected
                              ? "bg-white text-zinc-900 shadow-sm shadow-zinc-950/[0.04] ring-1 ring-zinc-200/80"
                              : "text-zinc-500 hover:bg-zinc-50/80 hover:text-zinc-800"
                          }`}
                        >
                          {tab.label}
                          <span
                            className={
                              showUrgent && !isSelected
                                ? "text-red-500/90"
                                : isSelected
                                  ? "text-zinc-500"
                                  : "text-zinc-400"
                            }
                          >
                            · {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <BenchmarkFrameworkSelect selected={selectedFrameworks} onChange={handleBenchmarkChange} />
                  <FindingsStatusSelect
                    value={status}
                    onChange={setStatus}
                  />
                </div>

                <div className="findings-v2-control-cluster">
                  <input
                    value={searchText}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder="Search finding, ARN, resource…"
                    className="findings-v2-search h-8 rounded-[10px] border border-[#dce3ec] bg-white px-3 text-sm text-[#111827] outline-none placeholder:text-[#98a2b3] focus-visible:border-[#94a3b8] focus-visible:ring-2 focus-visible:ring-[#1f4e79]/15"
                  />
                  <div className="findings-v2-toolbar-group findings-v2-toolbar-group--divider" role="group" aria-label="Finding actions">
                    <button
                      type="button"
                      onClick={() => {
                        qc.invalidateQueries({ queryKey: ["findings"] });
                        setIsRefreshing(true);
                      }}
                      disabled={isRefreshing}
                      className="findings-v2-toolbar-btn findings-v2-toolbar-icon-btn"
                      aria-label={isRefreshing ? "Refreshing findings" : "Refresh findings"}
                      title={isRefreshing ? "Refreshing" : "Refresh"}
                    >
                      <svg className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4m-4 4a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" />
                      </svg>
                    </button>
                  </div>
                  <div className="findings-v2-toolbar-group" role="group" aria-label="Sort findings">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => toggleSort(opt.id)}
                        className="findings-v2-toolbar-btn"
                      >
                        {opt.label}
                        {sortKey === opt.id ? (
                          <span className="text-[13px] leading-none text-zinc-500">{sortDir === "asc" ? "↑" : "↓"}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                  <div className="findings-v2-toolbar-group findings-v2-actions-group" role="group" aria-label="Export and scan">
                    <button type="button" onClick={downloadCsv} className="findings-v2-toolbar-btn">
                      Export
                    </button>
                    {connectedId ? (
                      <FindingsScanButton
                        connectedId={connectedId}
                        isRunning={isRunning}
                        scanTriggered={scanTriggered}
                        onScan={triggerScan}
                      />
                    ) : null}
                  </div>
                </div>
              </div>

              {rows.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <p className="text-sm font-semibold text-zinc-700">
                    {searchTags.length > 0
                      ? "No findings match the selected checks"
                      : selectedFrameworks.length > 0
                        ? `No findings for ${benchmarkSelectionLabel(selectedFrameworks)}`
                        : emptyFindingsLabel(status)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">
                    {status === "open" ? "Run a scan or adjust filters." : "Nothing to show here."}
                  </p>
                </div>
              ) : (
                <>
                  <div
                    className="findings-v2-col-head hidden sm:grid sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
                    role="row"
                  >
                    <span className="w-5" aria-hidden />
                    <span className="w-[5.5rem]">Severity</span>
                    <span>Finding</span>
                    <span className="w-16 text-center">Risk</span>
                  </div>

                  <div className="divide-y divide-[#eef2f6]">
                    {displayGroups.map(([checkId, items]) => (
                      <FindingRow key={checkId} checkId={checkId} items={items} onReview={openReview} />
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        )}
      </div>

      <FindingDrawer
        finding={selected}
        accountId={selected?.account_id ?? connectedId ?? null}
        tab={drawerTab}
        onTabChange={setDrawerTab}
        remTab={remTab}
        onRemTabChange={setRemTab}
        verified={verified}
        verifyUnchanged={verifyUnchanged}
        verifying={verifying}
        onDismissVerifyOutcome={clearDrawerVerifyFlash}
        onClose={() => {
          setSelected(null);
          clearDrawerVerifyFlash();
        }}
        onAction={(id, action) => {
          if (action === "recheck") startRecheck(id, selected?.check_id ?? "");
          act.mutate({ id, action });
        }}
      />
    </div>
  );
}
