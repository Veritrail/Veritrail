import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

import { api } from "../api";
import { HistoryDashboard } from "../components/HistoryDashboard";
import { HistorySnapshotDrawer } from "../components/HistorySnapshotDrawer";
import { PageShell } from "../components/PageShell";
import {
  type ComplianceHistoryResponse,
  type HistoryEvent,
  scanShortDate,
} from "../lib/complianceHistory";
import { groupEventsByDay, sumFindingsResolvedInPeriod } from "../lib/historyTimeline";
import { causeSentence, eventPresentation, eventTypeLabel } from "../lib/historyPresentation";

interface Account {
  id: string;
  label: string;
  account_id: string | null;
  status: string;
}

const FRAMEWORKS = [
  { value: "soc2", label: "SOC 2" },
  { value: "cis_aws_l1", label: "CIS" },
  { value: "iso27001", label: "ISO" },
] as const;

const PERIODS = [30, 90, 180] as const;

function remediationLabel(event: HistoryEvent): string {
  return event.detail || event.top_change?.title || event.check_id || event.resource_arn || "Remediation verified";
}

function RemediationRollupCard({
  count,
  events,
  onExpand,
}: {
  count: number;
  events: HistoryEvent[];
  onExpand: () => void;
}) {
  const samples = events.map(remediationLabel).slice(0, 3);
  const more = count - samples.length;

  return (
    <article className="rounded-xl border border-emerald-200 bg-emerald-50/40 px-3 py-2">
      <p className="text-sm font-semibold text-zinc-900">
        {count} remediation{count === 1 ? "" : "s"} verified
      </p>
      {samples.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-zinc-600">
          {samples.map((s) => (
            <li key={s} className="truncate">
              {s}
            </li>
          ))}
          {more > 0 && <li className="text-zinc-400">+{more} more</li>}
        </ul>
      )}
      <button type="button" onClick={onExpand} className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800">
        Show details
      </button>
    </article>
  );
}

function TimelineEventCompact({
  event,
  previous,
  onOpen,
  onCompare,
  onInfra,
}: {
  event: HistoryEvent;
  previous: HistoryEvent | null;
  onOpen: () => void;
  onCompare: () => void;
  onInfra: () => void;
}) {
  const pres = eventPresentation(event);
  const cause = causeSentence(event);
  const baseline = event.type === "baseline_established";
  const isResolved = event.type === "finding_resolved";
  const infraCount = event.infrastructure_events_count ?? 0;

  const accent =
    baseline
      ? "border-zinc-300"
      : isResolved
        ? "border-emerald-400/70"
        : event.type === "compliance_regressed" || event.type === "finding_reopened"
          ? "border-rose-400/60"
          : "border-indigo-300/70";

  return (
    <article className={`border-l-2 ${accent} py-1 pl-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-zinc-900">{baseline ? pres.headline : eventTypeLabel(event.type)}</span>
        {!baseline && <time className="text-xs text-zinc-400">{scanShortDate(event.timestamp)}</time>}
      </div>

      {!baseline && (
        <p className="mt-1 text-xs text-zinc-600">
          {event.posture_before != null && event.posture_after != null && event.posture_before !== event.posture_after ? (
            <>
              <span className="tabular-nums">{event.posture_before}%</span>
              <span className="text-zinc-300"> → </span>
              <span className="font-semibold tabular-nums text-zinc-900">{event.posture_after}%</span>
            </>
          ) : isResolved ? (
            <span className="line-clamp-1">{pres.subline}</span>
          ) : (
            <span className="font-semibold tabular-nums text-zinc-900">{event.posture_after ?? "—"}%</span>
          )}
        </p>
      )}

      {cause && !baseline && !isResolved && (
        <p className="mt-1 line-clamp-1 text-xs text-zinc-500">
          {cause.control} {cause.text}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-x-3 text-xs">
        <button type="button" onClick={onOpen} className="font-medium text-indigo-600 hover:text-indigo-800">
          View evidence
        </button>
        {previous && !baseline && (
          <button type="button" onClick={onCompare} className="text-zinc-500 hover:text-zinc-700">
            Compare
          </button>
        )}
        {infraCount > 0 && (
          <button type="button" onClick={onInfra} className="text-zinc-400 hover:text-zinc-600">
            Supporting ({infraCount})
          </button>
        )}
      </div>
    </article>
  );
}

function HistoryTimeline({
  dayGroups,
  previousById,
  expandedRollups,
  setExpandedRollups,
  onDrawer,
}: {
  dayGroups: ReturnType<typeof groupEventsByDay>;
  previousById: Map<string, HistoryEvent | null>;
  expandedRollups: Record<string, boolean>;
  setExpandedRollups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onDrawer: (payload: {
    event: HistoryEvent;
    previous: HistoryEvent | null;
    tab: "snapshot" | "compare";
    infra: boolean;
  }) => void;
}) {
  if (dayGroups.length === 0) return null;

  return (
    <div className="space-y-5">
      {dayGroups.map((group) => {
        const remediations = group.events.filter((e) => e.type === "finding_resolved");
        const others = group.events.filter((e) => e.type !== "finding_resolved");
        const expanded = expandedRollups[group.day] ?? false;
        const rollupRemediations = remediations.length >= 2 && !expanded;

        return (
          <div key={group.day}>
            <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-400">{group.label}</h3>
            <div className="mt-2 space-y-2">
              {rollupRemediations && (
                <RemediationRollupCard
                  count={remediations.length}
                  events={remediations}
                  onExpand={() => setExpandedRollups((p) => ({ ...p, [group.day]: true }))}
                />
              )}
              {(rollupRemediations ? others : [...remediations, ...others]).map((evt) => {
                const previous = previousById.get(evt.scan_run_id) ?? null;
                return (
                  <TimelineEventCompact
                    key={evt.scan_run_id}
                    event={evt}
                    previous={previous}
                    onOpen={() => onDrawer({ event: evt, previous, tab: "snapshot", infra: false })}
                    onCompare={() => onDrawer({ event: evt, previous, tab: "compare", infra: false })}
                    onInfra={() => onDrawer({ event: evt, previous, tab: "snapshot", infra: true })}
                  />
                );
              })}
              {expanded && remediations.length >= 2 && (
                <button
                  type="button"
                  onClick={() => setExpandedRollups((p) => ({ ...p, [group.day]: false }))}
                  className="text-xs font-medium text-zinc-500 hover:text-zinc-800"
                >
                  Hide remediation details
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function HistoryV2() {
  const [days, setDays] = useState(90);
  const [framework, setFramework] = useState("soc2");
  const [accountId, setAccountId] = useState("");
  const [expandedRollups, setExpandedRollups] = useState<Record<string, boolean>>({});
  const [drawer, setDrawer] = useState<{
    event: HistoryEvent;
    previous: HistoryEvent | null;
    tab: "snapshot" | "compare";
    infra: boolean;
  } | null>(null);

  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/v1/accounts") });
  const connected = accountsQ.data?.filter((a) => a.status === "connected") ?? [];
  const effectiveAccountId = accountId || connected[0]?.id || "";

  const historyQ = useQuery<ComplianceHistoryResponse>({
    queryKey: ["history", effectiveAccountId, framework, days],
    queryFn: () =>
      api(`/v1/accounts/${effectiveAccountId}/compliance-timeline?framework=${framework}&days=${days}&limit=40`),
    enabled: !!effectiveAccountId,
  });

  const events = historyQ.data?.events ?? [];
  const previousById = useMemo(() => {
    const map = new Map<string, HistoryEvent | null>();
    events.forEach((evt, index) => map.set(evt.scan_run_id, index + 1 < events.length ? events[index + 1] : null));
    return map;
  }, [events]);

  const dayGroups = useMemo(() => groupEventsByDay(events), [events]);
  const resolvedInPeriod = sumFindingsResolvedInPeriod(events);
  const onlyBaseline = events.length === 1 && events[0]?.type === "baseline_established";

  if (accountsQ.data && connected.length === 0) return <Navigate to="/accounts" replace />;

  const headerActions = (
    <div className="flex flex-wrap items-center justify-end gap-2 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm shadow-zinc-950/[0.02]">
      <select
        value={effectiveAccountId}
        onChange={(e) => setAccountId(e.target.value)}
        className="h-8 max-w-[12rem] truncate rounded-lg border-0 bg-zinc-50 px-2 text-xs font-semibold text-zinc-700 outline-none ring-1 ring-inset ring-zinc-200"
        aria-label="Account"
      >
        {connected.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
      <div className="h-6 w-px bg-zinc-200" />
      <div className="inline-flex rounded-lg bg-zinc-100 p-0.5" role="group" aria-label="Framework">
        {FRAMEWORKS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFramework(f.value)}
            className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
              framework === f.value ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="inline-flex rounded-lg bg-zinc-100 p-0.5" role="group" aria-label="Period">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setDays(p)}
            className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
              days === p ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            {p}d
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <PageShell
        variant="compact"
        eyebrow="SECURITY PROGRESS"
        title="History"
        description="Posture, findings, controls, and remediation movement over time."
        actions={headerActions}
        width="w-full max-w-none"
      >
        {historyQ.isLoading && (
          <p className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-center text-sm text-zinc-500">Loading history…</p>
        )}

        {historyQ.isError && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-900">
            History is temporarily unavailable. Try again in a moment.
          </p>
        )}

        {!historyQ.isLoading && !historyQ.isError && historyQ.data && (
          <HistoryDashboard
            events={events}
            days={days}
            currentScore={historyQ.data.current_posture_score}
            currentSummary={historyQ.data.current_summary}
            periodSummary={historyQ.data.period_summary}
            scanCount={historyQ.data.scan_count}
            scanCadence={historyQ.data.scan_cadence}
            persistentGaps={historyQ.data.persistent_gaps}
            resolvedInPeriod={resolvedInPeriod}
            onSelectSnapshot={(id) => {
              const evt = events.find((e) => e.scan_run_id === id);
              if (evt) {
                setDrawer({
                  event: evt,
                  previous: previousById.get(id) ?? null,
                  tab: "snapshot",
                  infra: false,
                });
              }
            }}
            timeline={
              onlyBaseline ? (
                <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50 px-3 py-4 text-center">
                  <p className="text-xs font-medium text-zinc-800">Baseline recorded</p>
                  <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-zinc-500">
                    History starts with your first completed scan. Remediations, exceptions, and control changes will appear here.
                  </p>
                </div>
              ) : events.length > 0 ? (
                <HistoryTimeline
                  dayGroups={dayGroups}
                  previousById={previousById}
                  expandedRollups={expandedRollups}
                  setExpandedRollups={setExpandedRollups}
                  onDrawer={setDrawer}
                />
              ) : (
                <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50 px-3 py-4 text-center">
                  <p className="text-xs font-medium text-zinc-800">No events in this window</p>
                  <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-zinc-500">
                    Run a scan or verify a remediation from Findings to populate this timeline.
                  </p>
                </div>
              )
            }
          />
        )}
      </PageShell>

      {drawer && (
        <HistorySnapshotDrawer
          event={drawer.event}
          previousEvent={drawer.previous}
          accountId={effectiveAccountId}
          periodDays={days}
          initialTab={drawer.tab}
          expandInfrastructure={drawer.infra}
          onClose={() => setDrawer(null)}
        />
      )}
    </>
  );
}
