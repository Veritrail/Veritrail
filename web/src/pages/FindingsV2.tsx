import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api, token } from "../api";
import ConnectAwsEmptyState from "../components/ConnectAwsEmptyState";
import NotificationsBell from "../components/NotificationsBell";
import ScanProgressBar from "../components/ScanProgressBar";
import { FindingDrawer, defaultFindingRemediationMode, type FindingDrawerTab, type FindingRemediationMode } from "../components/FindingDrawer";
import { checkLabels } from "../data/checkLabels";
import { CHECK_FRAMEWORK_MAP } from "../data/checkFrameworkMap";
import { FRAMEWORKS, frameworkLabel, type FrameworkId } from "../data/frameworks";
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
type SeverityFilter = "all" | "critical" | "high" | "medium" | "low";

const severityTabs: { id: SeverityFilter; label: string; urgent?: boolean }[] = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical", urgent: true },
  { id: "high", label: "High", urgent: true },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];
type SortKey = "severity" | "score" | "first_seen";
type BenchmarkFilter = "all" | FrameworkId;

const statusTabs: StatusTab[] = ["open", "excepted", "resolved", "all"];
const statusTabLabels: Record<StatusTab, string> = {
  open: "Open",
  excepted: "Exceptions",
  resolved: "Resolved",
  all: "All",
};
const sevWeight: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "severity", label: "Severity" },
  { id: "score", label: "Risk" },
  { id: "first_seen", label: "Age" },
];

function lastScanLabel(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `today at ${time}` : `${date.toLocaleDateString()} at ${time}`;
}

function emptyFindingsLabel(status: StatusTab): string {
  if (status === "all") return "No findings";
  if (status === "excepted") return "No exceptions";
  return `No ${status} findings`;
}

function matchesSeverityFilter(f: Finding, filter: SeverityFilter): boolean {
  if (filter === "all") return true;
  return f.severity === filter;
}

function frameworksForCheck(checkId: string, apiMap: Record<string, string[]> | undefined): string[] {
  return apiMap?.[checkId] ?? CHECK_FRAMEWORK_MAP[checkId] ?? [];
}

function matchesBenchmarkFilter(f: Finding, filter: BenchmarkFilter, apiMap: Record<string, string[]> | undefined): boolean {
  if (filter === "all") return true;
  return frameworksForCheck(f.check_id, apiMap).includes(filter);
}

function SeverityIndicator({ severity }: { severity: string }) {
  const badgeClass =
    "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium";
  if (severity === "critical") {
    return (
      <span className={`${badgeClass} bg-red-50/80 text-red-700 ring-1 ring-red-200/45`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500/75" aria-hidden />
        Critical
      </span>
    );
  }
  if (severity === "high") {
    return (
      <span className={`${badgeClass} bg-amber-50/90 text-amber-800 ring-1 ring-amber-200/50`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/80" aria-hidden />
        High
      </span>
    );
  }
  if (severity === "medium") {
    return (
      <span className={`${badgeClass} bg-zinc-100/90 text-zinc-600 ring-1 ring-zinc-200/70`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400/80" aria-hidden />
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
  const scoreClass =
    severity === "critical" || severity === "high" || severity === "medium" || severity === "low"
      ? `findings-v2-risk-score--${severity}`
      : "findings-v2-risk-score--low";

  return (
    <div className="findings-v2-risk" aria-label={`Risk score ${score}`}>
      <span className="findings-v2-risk-label">Risk</span>
      <span className={`findings-v2-risk-value ${scoreClass}`}>{score}</span>
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
  const railClass =
    sev === "critical" || sev === "high" || sev === "medium" || sev === "low"
      ? `findings-v2-row--${sev}`
      : "findings-v2-row--low";

  return (
    <button
      type="button"
      onClick={() => onReview(items)}
      aria-label={`Review ${title}, ${severityLabel(sev)}`}
      className={`findings-v2-row ${railClass} grid w-full grid-cols-1 gap-3 py-2.5 pl-4 pr-4 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4`}
    >
      <div className="sm:w-[5.5rem] shrink-0">
        <SeverityIndicator severity={sev} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold leading-snug tracking-[-0.01em] text-[#111827]">{title}</p>
        {items.length === 1 ? (
          <p className="mt-0.5 truncate font-mono text-[11px] leading-tight text-[#6b7280]">{shortArn(items[0]?.resource_arn ?? null)}</p>
        ) : (
          <p className="mt-0.5 text-[11px] font-medium leading-tight text-[#98a2b3]">{items.length} resources</p>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-start sm:justify-center">
        <RiskScoreDisplay score={topRisk} severity={sev} />
      </div>

      <div className="flex shrink-0 items-center justify-end">
        <span className="findings-v2-review-btn" aria-hidden>
          <span>Review</span>
          <span className="findings-v2-review-btn-chevron">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.25} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </span>
        </span>
      </div>
    </button>
  );
}

export default function FindingsV2() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusTab>("open");
  const [selected, setSelected] = useState<Finding | null>(null);
  const [drawerGroup, setDrawerGroup] = useState<Finding[] | null>(null);
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
  const [benchmarkFilter, setBenchmarkFilter] = useState<BenchmarkFilter>(() => {
    const fw = searchParams.get("framework");
    if (fw && FRAMEWORKS.some((f) => f.id === fw)) return fw as FrameworkId;
    return "all";
  });
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
  const selectedAccount = connectedAccounts.find((a) => a.id === effectiveAccountId) ?? connectedAccounts[0];
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

  const lastScanAt = selectedAccount?.last_scan_at ?? scanRun.data?.finished_at ?? null;

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
    () => findings.filter((f) => matchesBenchmarkFilter(f, benchmarkFilter, checkFrameworksApi)),
    [findings, benchmarkFilter, checkFrameworksApi],
  );

  const rows = useMemo(() => {
    const qtext = searchText.trim().toLowerCase();
    const arr = benchmarkScopedFindings.filter((f) => {
      if (status === "open" && !matchesSeverityFilter(f, severityFilter)) return false;
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
    const counts = { all: 0, critical: 0, high: 0, medium: 0, low: 0 };
    if (status !== "open") return counts;
    for (const f of benchmarkScopedFindings) {
      counts.all += 1;
      if (f.severity === "critical") counts.critical += 1;
      else if (f.severity === "high") counts.high += 1;
      else if (f.severity === "medium") counts.medium += 1;
      else if (f.severity === "low") counts.low += 1;
    }
    return counts;
  }, [benchmarkScopedFindings, status]);

  function openReview(items: Finding[]) {
    const top = items.reduce((best, f) => (f.risk_score > best.risk_score ? f : best), items[0]);
    setDrawerGroup(items.length > 1 ? items : null);
    setSelected(top);
    setDrawerTab("overview");
    setRemTab(defaultFindingRemediationMode(top.check_id));
    clearDrawerVerifyFlash();
  }

  function handleBenchmarkChange(fw: BenchmarkFilter) {
    setBenchmarkFilter(fw);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (fw === "all") next.delete("framework");
        else next.set("framework", fw);
        return next;
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
              <p className="mt-1.5 text-sm text-[#6b7280]">
                {selectedAccount?.account_id && <span>Account {selectedAccount.account_id}</span>}
                {lastScanAt && (
                  <>
                    {selectedAccount?.account_id && <span className="text-[#98a2b3]"> · </span>}
                    <span className="text-slate-400">Last scan </span>
                    <span className="font-medium tabular-nums text-slate-500">{lastScanLabel(lastScanAt)}</span>
                  </>
                )}
              </p>
            </div>
            <NotificationsBell />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#e6ebf2] pb-3">
            <div
              className="inline-flex min-w-0 flex-wrap rounded-lg border border-[#e6ebf2] bg-[#f8fafc] p-0.5"
              role="tablist"
              aria-label="Benchmark scope"
            >
              <button
                type="button"
                role="tab"
                aria-selected={benchmarkFilter === "all"}
                onClick={() => handleBenchmarkChange("all")}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                  benchmarkFilter === "all" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                All benchmarks
              </button>
              {FRAMEWORKS.map((fw) => (
                <button
                  key={fw.id}
                  type="button"
                  role="tab"
                  aria-selected={benchmarkFilter === fw.id}
                  onClick={() => handleBenchmarkChange(fw.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                    benchmarkFilter === fw.id ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
                  }`}
                >
                  {fw.label}
                </button>
              ))}
            </div>

            {connectedId && (
              <div className="flex shrink-0 items-center gap-2.5 self-center">
                {connectedAccounts.length > 1 && (
                  <select
                    value={effectiveAccountId}
                    onChange={(e) => handleAccountChange(e.target.value)}
                    aria-label="AWS account"
                    className="findings-v2-status-select"
                  >
                    {connectedAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.account_id ?? a.label ?? "Account"}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => triggerScan(connectedId)}
                  disabled={scanTriggered || isRunning}
                  className="findings-v2-scan-btn"
                >
                  <span className="findings-v2-scan-btn-icon" aria-hidden>
                    <svg
                      className={`h-3.5 w-3.5 ${isRunning || scanTriggered ? "animate-spin" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
                      />
                    </svg>
                  </span>
                  <span className="findings-v2-scan-btn-label">
                    {isRunning ? "Scanning…" : scanTriggered ? "Starting…" : "Start scan"}
                  </span>
                </button>
              </div>
            )}
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

        {!q.isLoading && rows.length === 0 && (
          <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-16 text-center shadow-sm">
            <p className="text-sm font-semibold text-zinc-700">
              {searchTags.length > 0
                ? "No findings match the selected checks"
                : benchmarkFilter !== "all"
                  ? `No findings for ${frameworkLabel(benchmarkFilter)}`
                  : emptyFindingsLabel(status)}
            </p>
            <p className="mt-1 text-xs text-zinc-400">{status === "open" ? "Run a scan or adjust filters." : "Nothing to show here."}</p>
          </div>
        )}

        {!q.isLoading && rows.length > 0 && (
          <section className="min-w-0">
            <div className="overflow-hidden rounded-2xl border border-[#e6ebf2] bg-white shadow-sm shadow-zinc-950/[0.04]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef2f6] bg-[#f8fafc]/80 px-4 py-3.5 sm:px-5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {status === "open" ? (
                    <div
                      className="inline-flex min-w-0 flex-wrap items-center gap-1 rounded-xl border border-[#e6ebf2] bg-white p-1"
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
                            className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-all ${
                              isSelected
                                ? "bg-[#f8fafc] text-[#1f4e79] ring-1 ring-[#dce3ec]"
                                : "text-[#6b7280] hover:bg-[#f8fafc] hover:text-[#111827]"
                            }`}
                          >
                            {tab.label}
                            <span
                              className={
                                showUrgent && !isSelected
                                  ? "text-red-500/90"
                                  : isSelected
                                    ? "text-[#1f4e79]/70"
                                    : "text-[#98a2b3]"
                              }
                            >
                              {" "}
                              · {count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm font-semibold text-[#111827]">{statusTabLabels[status]}</p>
                  )}

                  <div className="relative shrink-0">
                    <label htmlFor="findings-status-filter" className="sr-only">
                      Status
                    </label>
                    <select
                      id="findings-status-filter"
                      value={status}
                      onChange={(e) => {
                        const next = e.target.value as StatusTab;
                        setStatus(next);
                        if (next !== "open") setSeverityFilter("all");
                      }}
                      className="findings-v2-status-select"
                    >
                      {statusTabs.map((s) => (
                        <option key={s} value={s}>
                          {statusTabLabels[s]}
                        </option>
                      ))}
                    </select>
                    <svg
                      className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#98a2b3]"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                      aria-hidden
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:gap-3">
                  <input
                    value={searchText}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder="Search finding, ARN, resource…"
                    className="h-8 min-w-[12rem] flex-1 basis-[12rem] rounded-[10px] border border-[#dce3ec] bg-white px-3 text-sm text-[#111827] outline-none placeholder:text-[#98a2b3] focus-visible:border-[#94a3b8] focus-visible:ring-2 focus-visible:ring-[#1f4e79]/15"
                  />
                  <div className="findings-v2-toolbar-group findings-v2-toolbar-group--divider" role="group" aria-label="Sort findings">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => toggleSort(opt.id)}
                        className={`findings-v2-toolbar-btn ${sortKey === opt.id ? "is-active" : ""}`}
                      >
                        {opt.label}
                        {sortKey === opt.id ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                      </button>
                    ))}
                  </div>
                  <div className="findings-v2-toolbar-group findings-v2-toolbar-group--divider">
                    <button type="button" onClick={downloadCsv} className="findings-v2-toolbar-btn">
                      Export
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        qc.invalidateQueries({ queryKey: ["findings"] });
                        setIsRefreshing(true);
                      }}
                      disabled={isRefreshing}
                      className="findings-v2-toolbar-btn"
                    >
                      {isRefreshing ? "Refreshing…" : "Refresh"}
                    </button>
                  </div>
                </div>
              </div>

              <div
                className="findings-v2-col-head hidden sm:grid sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
                role="row"
              >
                <span className="w-[5.5rem]">Severity</span>
                <span>Finding</span>
                <span className="text-center">Risk</span>
                <span className="w-[5.5rem]" aria-hidden />
              </div>

              <div className="space-y-2 bg-[#f7f9fc] p-3 sm:p-4">
                {displayGroups.map(([checkId, items]) => (
                  <FindingRow key={checkId} checkId={checkId} items={items} onReview={openReview} />
                ))}
              </div>
            </div>
          </section>
        )}
      </div>

      <FindingDrawer
        finding={selected}
        relatedFindings={drawerGroup ?? undefined}
        onSelectRelated={(f) => setSelected(f)}
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
          setDrawerGroup(null);
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
