import { useCallback, useEffect, useMemo, useState } from "react";
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
import { remediationSummaryFor } from "../data/remediationSummaries";
import { affectedResourcesPreview, daysAgo, severityLabel } from "../lib/findingDisplay";
import { isAccountConnected } from "../lib/accountConnection";
import { useTriggeredScan } from "../hooks/useTriggeredScan";
import { useRecheckNotifications, type RecheckResponse } from "../context/RecheckNotificationsContext";

type Finding = {
  id: string;
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
type Account = { id: string; status: string; cfn_launch_url?: string };
type StatusTab = "open" | "excepted" | "resolved" | "all";
type SeverityFilter = "all" | "critical_high" | "medium" | "low";
type SortKey = "severity" | "score" | "first_seen";
type BenchmarkFilter = "all" | FrameworkId;

const statusTabs: StatusTab[] = ["open", "excepted", "resolved", "all"];
const statusTabLabels: Record<StatusTab, string> = { open: "Open", excepted: "Exceptions", resolved: "Resolved", all: "All" };
const sevWeight: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const sevBadge: Record<string, string> = {
  critical: "bg-red-50 text-red-700 ring-red-200/70",
  high: "bg-orange-50 text-orange-700 ring-orange-200/70",
  medium: "bg-amber-50 text-amber-800 ring-amber-200/70",
  low: "bg-zinc-100 text-zinc-600 ring-zinc-200/70",
};
const sevRail: Record<string, string> = {
  critical: "from-red-500 to-red-300",
  high: "from-orange-500 to-orange-300",
  medium: "from-amber-400 to-amber-200",
  low: "from-zinc-300 to-zinc-200",
};
const sevText: Record<string, string> = {
  critical: "text-red-700",
  high: "text-orange-700",
  medium: "text-amber-700",
  low: "text-zinc-700",
};

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
  if (filter === "critical_high") return f.severity === "critical" || f.severity === "high";
  return f.severity === filter;
}

function frameworksForCheck(checkId: string, apiMap: Record<string, string[]> | undefined): string[] {
  return apiMap?.[checkId] ?? CHECK_FRAMEWORK_MAP[checkId] ?? [];
}

function matchesBenchmarkFilter(f: Finding, filter: BenchmarkFilter, apiMap: Record<string, string[]> | undefined): boolean {
  if (filter === "all") return true;
  return frameworksForCheck(f.check_id, apiMap).includes(filter);
}

function sortLabel(k: SortKey): string {
  if (k === "first_seen") return "Age";
  if (k === "score") return "Risk";
  return "Severity";
}

function MetricCard({ label, value, detail, active, tone, onClick }: { label: string; value: number; detail: string; active: boolean; tone: "neutral" | "bad" | "warn"; onClick: () => void }) {
  const toneClass = tone === "bad" ? "text-red-700 ring-red-100" : tone === "warn" ? "text-amber-700 ring-amber-100" : "text-zinc-950 ring-zinc-100";
  return (
    <button type="button" onClick={onClick} className={`rounded-2xl border bg-white px-4 py-3 text-left shadow-sm shadow-zinc-950/[0.03] ring-1 transition hover:-translate-y-0.5 hover:shadow-md ${active ? "border-zinc-300" : "border-zinc-200"} ${toneClass}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{detail}</p>
    </button>
  );
}

function StatusTabs({ status, onChange }: { status: StatusTab; onChange: (status: StatusTab) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-zinc-200/80 bg-zinc-100/60 p-1">
      {statusTabs.map((s) => <button key={s} type="button" onClick={() => onChange(s)} className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${status === s ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200/80" : "text-zinc-500 hover:text-zinc-800"}`}>{statusTabLabels[s]}</button>)}
    </div>
  );
}

function BenchmarkSelect({ value, onChange }: { value: BenchmarkFilter; onChange: (v: BenchmarkFilter) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as BenchmarkFilter)} className="h-10 min-w-[12rem] rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20">
      <option value="all">All benchmarks</option>
      {FRAMEWORKS.map((fw) => <option key={fw.id} value={fw.id}>{fw.label}</option>)}
    </select>
  );
}

function SortToggle({ sortKey, sortDir, onToggle }: { sortKey: SortKey; sortDir: "asc" | "desc"; onToggle: (k: SortKey) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-zinc-200/80 bg-zinc-100/60 p-1">
      {(["severity", "score", "first_seen"] as SortKey[]).map((k) => <button key={k} type="button" onClick={() => onToggle(k)} className={`h-8 rounded-lg px-3 text-xs font-semibold transition ${sortKey === k ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}>{sortLabel(k)} {sortKey === k ? (sortDir === "asc" ? "↑" : "↓") : ""}</button>)}
    </div>
  );
}

function FindingIssueCard({ checkId, items, onReview }: { checkId: string; items: Finding[]; onReview: (items: Finding[]) => void }) {
  const sev = items[0]?.severity ?? "low";
  const title = checkLabels[checkId] ?? items[0]?.title ?? checkId;
  const ops = remediationSummaryFor(checkId);
  const count = items.length;
  const topRisk = Math.max(...items.map((f) => f.risk_score));
  const oldest = items.reduce((a, b) => (new Date(a.first_seen) < new Date(b.first_seen) ? a : b));
  const affectedPreview = affectedResourcesPreview(items);

  return (
    <article role="button" tabIndex={0} onClick={() => onReview(items)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onReview(items); } }} className="group relative cursor-pointer overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm shadow-zinc-950/[0.03] ring-1 ring-zinc-100 transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30">
      <div className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${sevRail[sev] ?? sevRail.low}`} />
      <div className="flex items-start justify-between gap-5 pl-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ring-1 ${sevBadge[sev] ?? sevBadge.low}`}>{severityLabel(sev)}</span>
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500 ring-1 ring-zinc-200/70">{count} resource{count === 1 ? "" : "s"}</span>
            <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-zinc-400 ring-1 ring-zinc-200/70">First seen {daysAgo(oldest.first_seen)}</span>
          </div>
          <h3 className="mt-3 text-base font-bold leading-snug tracking-tight text-zinc-950">{title}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-600">{ops.impact}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">{ops.fix}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-3">
          <div className="rounded-2xl bg-zinc-50 px-3 py-2 text-right ring-1 ring-zinc-100">
            <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Risk</p>
            <p className={`text-2xl font-bold tabular-nums ${sevText[sev] ?? sevText.low}`}>{topRisk}</p>
          </div>
          <button type="button" onClick={(e) => { e.stopPropagation(); onReview(items); }} className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-950 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 active:scale-[0.98]">Review <span aria-hidden>→</span></button>
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50/80 px-3 py-2.5">
        {affectedPreview ? <p className="truncate font-mono text-[13px] text-zinc-700">{affectedPreview}</p> : <p className="text-[13px] text-zinc-500">No resource names available</p>}
      </div>
    </article>
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
  const { pendingRecheck, recheckOutcome, startRecheck, applyRecheckResult, failRecheck, clearDrawerVerifyFlash } = useRecheckNotifications();

  const frameworkMapQ = useQuery({ queryKey: ["check-frameworks"], queryFn: () => api<{ checks: Record<string, string[]> }>("/v1/controls/check-frameworks"), staleTime: 300_000 });
  const q = useQuery({ queryKey: ["findings", status], queryFn: () => api<FindingPage>(`/v1/findings?status=${status}&limit=500`), refetchInterval: pendingRecheck ? 3000 : false });
  const openMetricsQ = useQuery({ queryKey: ["findings", "open"], queryFn: () => api<FindingPage>("/v1/findings?status=open&limit=500"), refetchInterval: pendingRecheck ? 3000 : false });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/v1/accounts") });
  const connectedAccount = accounts.data?.find((a) => isAccountConnected(a));
  const connectedId = connectedAccount?.id;
  const { scanRun, scanStatus, isRunning, scanTriggered, isScanActive, scanProgress, triggerScan } = useTriggeredScan(connectedId, { onScanComplete: () => qc.invalidateQueries({ queryKey: ["findings"] }) });

  useEffect(() => { if (isRefreshing && !q.isFetching) { const t = setTimeout(() => setIsRefreshing(false), 600); return () => clearTimeout(t); } }, [q.isFetching, isRefreshing]);

  useEffect(() => {
    const raw = searchParams.get("checks");
    const next = raw ? raw.split(",").filter(Boolean) : [];
    setSearchTags(next);
    if (next.length > 0) setStatus("open");
  }, [searchParams]);

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "recheck" | "reopen" }) => api(`/v1/findings/${id}/${action}`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: (data, { id, action }) => {
      if (action === "recheck") {
        const result = data as RecheckResponse;
        const checkId = selected?.check_id ?? result.check_id ?? "";
        if (!applyRecheckResult(id, checkId, result)) setTimeout(() => qc.invalidateQueries({ queryKey: ["findings"] }), 6000);
      } else {
        qc.invalidateQueries({ queryKey: ["findings"] });
        if (selected) setSelected(data as Finding);
        if (action === "reopen") { clearDrawerVerifyFlash(); setStatus("open"); }
      }
    },
    onError: (_err, { id, action }) => { if (action === "recheck" && selected) failRecheck(id, selected.check_id); },
  });

  const findings = q.data?.items ?? [];
  const checkFrameworksApi = frameworkMapQ.data?.checks;
  const openFindingsForMetrics = openMetricsQ.data?.items ?? (status === "open" ? findings : []);
  const verifying = !!(selected && pendingRecheck?.findingId === selected.id);
  const verified = !!(selected && recheckOutcome?.findingId === selected.id && recheckOutcome.status === "verified");
  const verifyUnchanged = !!(selected && recheckOutcome?.findingId === selected.id && recheckOutcome.status === "unchanged");

  const metricBenchmarkScoped = useMemo(() => openFindingsForMetrics.filter((f) => matchesBenchmarkFilter(f, benchmarkFilter, checkFrameworksApi)), [openFindingsForMetrics, benchmarkFilter, checkFrameworksApi]);
  const metricTotals = useMemo(() => {
    const t = { open: 0, critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of metricBenchmarkScoped) { t.open++; if (f.severity in t) t[f.severity as keyof typeof t]++; }
    return t;
  }, [metricBenchmarkScoped]);

  const benchmarkScopedFindings = useMemo(() => findings.filter((f) => matchesBenchmarkFilter(f, benchmarkFilter, checkFrameworksApi)), [findings, benchmarkFilter, checkFrameworksApi]);
  const rows = useMemo(() => {
    const qtext = searchText.trim().toLowerCase();
    const arr = benchmarkScopedFindings.filter((f) => {
      if (status === "open" && !matchesSeverityFilter(f, severityFilter)) return false;
      if (searchTags.length > 0) {
        const matchesCheck = searchTags.some((tag) => {
          if (f.check_id === tag) return true;
          const haystack = [f.title, f.check_id, f.resource_arn, checkLabels[f.check_id] ?? ""]
            .join(" ")
            .toLowerCase();
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
      if (sortKey === "severity") cmp = (sevWeight[a[0].severity] ?? 9) - (sevWeight[b[0].severity] ?? 9) || Math.max(...b.map((f) => f.risk_score)) - Math.max(...a.map((f) => f.risk_score));
      else if (sortKey === "score") cmp = Math.max(...b.map((f) => f.risk_score)) - Math.max(...a.map((f) => f.risk_score));
      else cmp = Math.min(...b.map((f) => new Date(f.first_seen).getTime())) - Math.min(...a.map((f) => new Date(f.first_seen).getTime()));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return entries;
  }, [rows, sortKey, sortDir]);

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
    setSearchParams((prev) => { const next = new URLSearchParams(prev); if (fw === "all") next.delete("framework"); else next.set("framework", fw); return next; }, { replace: true });
  }

  function handleSearch(value: string) {
    setSearchText(value);
    setSearchParams((prev) => { const next = new URLSearchParams(prev); if (value.trim()) next.set("q", value.trim()); else next.delete("q"); return next; }, { replace: true });
  }

  function handleTagsChange(tags: string[]) {
    setSearchTags(tags);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tags.length > 0) next.set("checks", tags.join(","));
      else next.delete("checks");
      return next;
    }, { replace: true });
  }

  const downloadCsv = useCallback(async () => {
    const BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:8000";
    const t = token();
    const res = await fetch(`${BASE}/v1/exports/findings.csv?status=${status}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
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

  const criticalHigh = metricTotals.critical + metricTotals.high;

  return (
    <div className="w-full space-y-6 pb-10">
      <header className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm shadow-zinc-950/[0.04]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 bg-gradient-to-br from-zinc-50 via-white to-indigo-50/30 px-6 py-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Findings</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              {scanRun.data?.finished_at && <span>Last scan {lastScanLabel(scanRun.data.finished_at)}</span>}
              {benchmarkFilter !== "all" && <span className="rounded-full bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-700 ring-1 ring-indigo-100">{frameworkLabel(benchmarkFilter)} scope</span>}
            </div>
          </div>
          <div className="flex items-center gap-2"><NotificationsBell /></div>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Open" value={metricTotals.open} detail="Active findings" active={severityFilter === "all" && status === "open"} tone="neutral" onClick={() => { setStatus("open"); setSeverityFilter("all"); }} />
          <MetricCard label="Critical + high" value={criticalHigh} detail="Needs priority review" active={severityFilter === "critical_high" && status === "open"} tone="bad" onClick={() => { setStatus("open"); setSeverityFilter("critical_high"); }} />
          <MetricCard label="Medium" value={metricTotals.medium} detail="Important hygiene work" active={severityFilter === "medium" && status === "open"} tone="warn" onClick={() => { setStatus("open"); setSeverityFilter("medium"); }} />
          <MetricCard label="Low" value={metricTotals.low} detail="Low-risk backlog" active={severityFilter === "low" && status === "open"} tone="neutral" onClick={() => { setStatus("open"); setSeverityFilter("low"); }} />
        </div>
      </header>

      {isScanActive && <ScanProgressBar phase={isRunning ? "running" : "starting"} progress={scanProgress.progress} elapsedMs={scanProgress.elapsedMs} remainingMs={scanProgress.remainingMs} finishing={scanProgress.finishing} indeterminate={scanProgress.indeterminate} progressStep={scanProgress.progressStep} progressTotal={scanProgress.progressTotal} />}
      {scanStatus === "error" && scanRun.data?.error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><span className="font-semibold">Last scan failed.</span><div className="mt-1 line-clamp-3 break-words text-xs text-red-700/90">{scanRun.data.error}</div></div>}

      <section className={`overflow-hidden rounded-3xl border bg-white shadow-sm shadow-zinc-950/[0.04] ${criticalHigh > 0 ? "border-red-200/70" : "border-zinc-200"}`}>
        {searchTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-indigo-100/80 bg-indigo-50/40 px-4 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-800/70">Check filter</span>
            {searchTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border border-indigo-200/80 bg-white px-2.5 py-1 text-xs font-medium text-indigo-900 shadow-sm"
              >
                <span className="truncate">{checkLabels[tag] ?? tag}</span>
                <button
                  type="button"
                  className="shrink-0 text-indigo-400 hover:text-indigo-800"
                  aria-label={`Remove ${checkLabels[tag] ?? tag} filter`}
                  onClick={() => handleTagsChange(searchTags.filter((t) => t !== tag))}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => handleTagsChange([])}
              className="text-xs font-semibold text-indigo-700 hover:text-indigo-900"
            >
              Clear all
            </button>
          </div>
        )}

        <div className="flex flex-col gap-3 border-b border-zinc-100 bg-zinc-50/70 px-4 py-4 xl:flex-row xl:items-center xl:justify-between">
          <StatusTabs status={status} onChange={setStatus} />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 xl:justify-end">
            <BenchmarkSelect value={benchmarkFilter} onChange={handleBenchmarkChange} />
            <input value={searchText} onChange={(e) => handleSearch(e.target.value)} placeholder="Search finding, ARN, resource…" className="h-10 min-w-[14rem] flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-800 shadow-sm outline-none placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20" />
            <SortToggle sortKey={sortKey} sortDir={sortDir} onToggle={(k) => { if (sortKey === k) setSortDir((d) => d === "asc" ? "desc" : "asc"); else { setSortKey(k); setSortDir(k === "severity" ? "asc" : "desc"); } }} />
            <button type="button" onClick={downloadCsv} className="h-10 rounded-xl border border-zinc-200 bg-white px-3.5 text-sm font-semibold text-zinc-600 shadow-sm transition hover:bg-zinc-50">Export</button>
            <button type="button" onClick={() => { qc.invalidateQueries({ queryKey: ["findings"] }); setIsRefreshing(true); }} disabled={isRefreshing} className="h-10 rounded-xl border border-zinc-200 bg-white px-3.5 text-sm font-semibold text-zinc-600 shadow-sm transition hover:bg-zinc-50 disabled:opacity-50">{isRefreshing ? "Refreshing…" : "Refresh"}</button>
            {connectedId && <button type="button" onClick={() => triggerScan(connectedId)} disabled={scanTriggered || isRunning} className="h-10 rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-50">{isRunning ? "Scanning…" : scanTriggered ? "Starting…" : "Re-scan"}</button>}
          </div>
        </div>

        {q.isLoading && <div className="px-4 py-12 text-center text-sm text-zinc-400">Loading…</div>}
        {!q.isLoading && rows.length === 0 && <div className="px-4 py-12 text-center"><p className="text-sm font-semibold text-zinc-700">{searchTags.length > 0 ? "No findings match the selected checks" : benchmarkFilter !== "all" ? `No findings for ${frameworkLabel(benchmarkFilter)}` : emptyFindingsLabel(status)}</p><p className="mt-1 text-xs text-zinc-400">{status === "open" ? "Run a scan or adjust filters." : "Nothing to show here."}</p></div>}
        {rows.length > 0 && <div className="grid gap-3 bg-zinc-50/60 p-4">{displayGroups.map(([checkId, items]) => <FindingIssueCard key={checkId} checkId={checkId} items={items} onReview={openReview} />)}</div>}
      </section>

      <FindingDrawer finding={selected} relatedFindings={drawerGroup ?? undefined} onSelectRelated={(f) => setSelected(f)} accountId={connectedId ?? null} tab={drawerTab} onTabChange={setDrawerTab} remTab={remTab} onRemTabChange={setRemTab} verified={verified} verifyUnchanged={verifyUnchanged} verifying={verifying} onDismissVerifyOutcome={clearDrawerVerifyFlash} onClose={() => { setSelected(null); setDrawerGroup(null); clearDrawerVerifyFlash(); }} onAction={(id, action) => { if (action === "recheck") startRecheck(id, selected?.check_id ?? ""); act.mutate({ id, action }); }} />
    </div>
  );
}
