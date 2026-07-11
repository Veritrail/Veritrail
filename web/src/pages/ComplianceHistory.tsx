import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

import { api } from "../api";
import { complianceTimelineSchema } from "../lib/apiSchemas";
import { HistoryDashboard } from "../components/HistoryDashboard";
import { HistorySnapshotDrawer } from "../components/HistorySnapshotDrawer";
import {
  type ComplianceHistoryResponse,
  type HistoryEvent,
  scanShortDate,
} from "../lib/complianceHistory";
import { ImpactList } from "../components/ImpactList";
import {
  causeSentence,
  eventPresentation,
  eventTypeLabel,
  impactItems,
} from "../lib/historyPresentation";

interface Account {
  id: string;
  label: string;
  account_id: string | null;
  status: string;
}

const FRAMEWORKS = [
  { value: "soc2", label: "SOC 2" },
  { value: "cis_aws_l1", label: "CIS" },
  { value: "iso27001", label: "ISO 27001" },
] as const;

const PERIOD_OPTIONS = [
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
  { value: 180, label: "180d" },
] as const;

function HeroDelta({ before, after }: { before: number | null; after: number | null }) {
  if (after == null) return null;
  if (before == null || before === after) {
    return <span className="text-2xl font-bold tabular-nums tracking-tight text-zinc-950">{after}%</span>;
  }
  const down = after < before;
  const pts = after - before;
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="flex items-baseline gap-1.5 text-2xl font-bold tabular-nums tracking-tight">
        <span className="text-zinc-300">{before}%</span>
        <span className="text-base font-normal text-zinc-300">→</span>
        <span className={down ? "text-rose-700" : "text-emerald-700"}>{after}%</span>
      </span>
      <span
        className={`rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${
          down ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
        }`}
      >
        {pts > 0 ? "+" : "−"}
        {Math.abs(pts)} pts
      </span>
    </span>
  );
}

function HistoryFilters({
  accounts,
  accountId,
  framework,
  days,
  onAccountChange,
  onFrameworkChange,
  onDaysChange,
}: {
  accounts: Account[];
  accountId: string;
  framework: string;
  days: number;
  onAccountChange: (value: string) => void;
  onFrameworkChange: (value: string) => void;
  onDaysChange: (value: number) => void;
}) {
  return (
    <div className="mt-5 rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm shadow-zinc-950/[0.02]">
      <div className="grid gap-2 lg:grid-cols-[minmax(14rem,1fr)_auto_auto] lg:items-center">
        <label className="flex min-w-0 items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2 ring-1 ring-zinc-200/70">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">Account</span>
          <select
            value={accountId}
            onChange={(e) => onAccountChange(e.target.value)}
            className="min-w-0 flex-1 appearance-none bg-transparent text-sm font-semibold text-zinc-900 outline-none"
            aria-label="Account"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2 rounded-xl bg-zinc-50 px-2 py-1.5 ring-1 ring-zinc-200/70">
          <span className="hidden text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400 sm:inline">Framework</span>
          <div className="inline-flex rounded-lg bg-white p-0.5 ring-1 ring-zinc-200/80" role="group" aria-label="Framework">
            {FRAMEWORKS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => onFrameworkChange(f.value)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                  framework === f.value
                    ? "bg-zinc-950 text-white shadow-sm"
                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-xl bg-zinc-50 px-2 py-1.5 ring-1 ring-zinc-200/70">
          <span className="hidden text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400 sm:inline">Window</span>
          <div className="inline-flex rounded-lg bg-white p-0.5 ring-1 ring-zinc-200/80" role="group" aria-label="Period">
            {PERIOD_OPTIONS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => onDaysChange(p.value)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                  days === p.value
                    ? "bg-zinc-950 text-white shadow-sm"
                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineEventCard({
  event,
  hasPrevious,
  onViewEvidence,
  onCompare,
  onInfrastructure,
}: {
  event: HistoryEvent;
  hasPrevious: boolean;
  onViewEvidence: () => void;
  onCompare: () => void;
  onInfrastructure: () => void;
}) {
  const pres = eventPresentation(event);
  const cause = causeSentence(event);
  const impacts = impactItems(event);
  const isBaseline = event.type === "baseline_established";

  return (
    <article className="relative pl-8">
      <span className="absolute left-0 top-2 h-3.5 w-3.5 rounded-full bg-white ring-4 ring-white" aria-hidden>
        <span className={`block h-3.5 w-3.5 rounded-full ${pres.dotClass}`} />
      </span>

      <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-3 shadow-sm shadow-zinc-950/[0.02] transition hover:border-zinc-300 hover:shadow-md hover:shadow-zinc-950/[0.04]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              <time>{scanShortDate(event.timestamp)}</time>
              <span className="text-zinc-300">·</span>
              <span>{eventTypeLabel(event.type)}</span>
            </div>
            {isBaseline ? (
              <h3 className="mt-1.5 text-base font-semibold tracking-tight text-zinc-950">{pres.headline}</h3>
            ) : (
              <div className="mt-1.5">
                <HeroDelta before={event.posture_before} after={event.posture_after} />
              </div>
            )}
          </div>
          {(event.findings_resolved ?? 0) > 0 && (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-100">
              {event.findings_resolved} resolved
            </span>
          )}
        </div>

        {cause && !isBaseline && (
          <p className="mt-2 text-sm text-zinc-900">
            <span className="font-semibold">{cause.control}</span>{" "}
            <span className={cause.tone === "bad" ? "text-rose-600" : cause.tone === "good" ? "text-emerald-600" : "text-zinc-500"}>
              {cause.text}
            </span>
          </p>
        )}

        {impacts.length > 0 && (
          <div className="mt-3 rounded-xl bg-zinc-50/80 px-3 py-2 ring-1 ring-zinc-100">
            <ImpactList items={impacts} size="sm" />
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          <button type="button" onClick={onViewEvidence} className="font-medium text-indigo-700 hover:text-indigo-900">
            View evidence
          </button>
          {hasPrevious && !isBaseline && (
            <button type="button" onClick={onCompare} className="font-medium text-zinc-500 hover:text-zinc-900">
              Compare
            </button>
          )}
          {(event.infrastructure_events_count ?? 0) > 0 && (
            <button type="button" onClick={onInfrastructure} className="font-medium text-zinc-500 hover:text-zinc-900">
              {event.infrastructure_events_count} infrastructure event{event.infrastructure_events_count === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function CompactTimeline({
  events,
  previousByScanId,
  openDrawer,
}: {
  events: HistoryEvent[];
  previousByScanId: Map<string, HistoryEvent | null>;
  openDrawer: (event: HistoryEvent, tab: "snapshot" | "compare", expandInfrastructure?: boolean) => void;
}) {
  if (events.length === 0) {
    return <p className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-10 text-sm text-zinc-500">No timeline events in this window.</p>;
  }

  return (
    <div className="relative space-y-5 before:absolute before:left-[6px] before:top-3 before:bottom-8 before:w-px before:bg-gradient-to-b before:from-emerald-200 before:via-zinc-200 before:to-transparent">
      {events.slice(0, 8).map((evt) => (
        <TimelineEventCard
          key={evt.scan_run_id}
          event={evt}
          hasPrevious={!!previousByScanId.get(evt.scan_run_id)}
          onViewEvidence={() => openDrawer(evt, "snapshot")}
          onCompare={() => openDrawer(evt, "compare")}
          onInfrastructure={() => openDrawer(evt, "snapshot", true)}
        />
      ))}
      {events.length > 8 && (
        <div className="pl-8 text-sm text-zinc-500">+{events.length - 8} older event{events.length - 8 === 1 ? "" : "s"}</div>
      )}
    </div>
  );
}

export default function ComplianceHistory() {
  const [days, setDays] = useState(90);
  const [framework, setFramework] = useState("soc2");
  const [accountId, setAccountId] = useState("");
  const [drawer, setDrawer] = useState<{
    event: HistoryEvent;
    tab: "snapshot" | "compare";
    previous: HistoryEvent | null;
    expandInfrastructure: boolean;
  } | null>(null);

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<Account[]>("/v1/accounts"),
  });

  const connected = accounts?.filter((a) => a.status === "connected") ?? [];
  const effectiveAccountId = accountId || connected[0]?.id || "";

  const { data, isLoading, error } = useQuery<ComplianceHistoryResponse>({
    queryKey: ["history", effectiveAccountId, framework, days],
    queryFn: () =>
      api(
        `/v1/accounts/${effectiveAccountId}/compliance-timeline?framework=${framework}&days=${days}&limit=40`,
        { schema: complianceTimelineSchema },
      ),
    enabled: !!effectiveAccountId,
  });

  const events = data?.events ?? [];

  const previousByScanId = useMemo(() => {
    const map = new Map<string, HistoryEvent | null>();
    for (let i = 0; i < events.length; i++) {
      map.set(events[i].scan_run_id, i + 1 < events.length ? events[i + 1] : null);
    }
    return map;
  }, [events]);

  const openDrawer = (event: HistoryEvent, tab: "snapshot" | "compare", expandInfrastructure = false) => {
    setDrawer({
      event,
      tab,
      previous: previousByScanId.get(event.scan_run_id) ?? null,
      expandInfrastructure,
    });
  };

  if (accounts && connected.length === 0) {
    return <Navigate to="/home" replace />;
  }

  return (
    <div className="w-full">
      <header className="mb-5 border-b border-zinc-200/80 pb-5">
        <HistoryFilters
          accounts={connected}
          accountId={effectiveAccountId}
          framework={framework}
          days={days}
          onAccountChange={setAccountId}
          onFrameworkChange={setFramework}
          onDaysChange={setDays}
        />
      </header>

      {isLoading && <p className="text-sm text-zinc-500">Loading compliance dashboard…</p>}
      {error && <p className="text-sm text-red-600">Could not load timeline.</p>}

      {!isLoading && !error && data && (
        <HistoryDashboard
          events={events}
          days={days}
          currentScore={data.current_posture_score}
          currentSummary={data.current_summary}
          periodSummary={data.period_summary}
          scanCount={data.scan_count}
          scanCadence={data.scan_cadence}
          persistentGaps={data.persistent_gaps}
          openFindingsCount={data.current_summary?.open_findings_count}
          resolvedInPeriod={data.period_summary?.findings_resolved}
          timeline={<CompactTimeline events={events} previousByScanId={previousByScanId} openDrawer={openDrawer} />}
          onSelectSnapshot={(scanRunId) => {
            const evt = events.find((e) => e.scan_run_id === scanRunId);
            if (evt) openDrawer(evt, "snapshot");
          }}
        />
      )}

      {!isLoading && !error && events.length === 0 && (data?.scan_count ?? 0) === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-12 text-sm text-zinc-500">
          No scans in this window. Run a scan after connecting your account to populate the dashboard.
        </p>
      )}

      {drawer && (
        <HistorySnapshotDrawer
          event={drawer.event}
          previousEvent={drawer.previous}
          accountId={effectiveAccountId}
          periodDays={days}
          initialTab={drawer.tab}
          expandInfrastructure={drawer.expandInfrastructure}
          allEvents={events}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}
