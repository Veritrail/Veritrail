import { useState } from "react";
import type { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { accountTimelineSchema } from "../lib/apiSchemas";
import { eventDisplayName, eventVerb, parseActor, primaryResourceName, type TimelineEvent } from "../lib/timelineDisplay";

interface InfraEvent {
  event_id: string;
  event_name: string;
  event_source: string;
  event_time: string;
  actor: string | null;
  region?: string | null;
  resources: { type: string | null; name: string | null }[];
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function InfraEventRow({ evt }: { evt: InfraEvent }) {
  const title = eventDisplayName(evt.event_name, evt.event_source);
  const actor = parseActor(evt.actor).label;
  const resource = primaryResourceName({ ...evt, type: "cloudtrail", source_ip: null } satisfies TimelineEvent);
  const region = evt.region ?? "—";
  const verb = eventVerb(evt.event_name);

  return (
    <li className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-zinc-900">{title}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{fmtTime(evt.event_time)}</span>
      </div>
      <p className="mt-1 text-xs text-zinc-600">
        {verb === "create" ? "Created" : verb === "delete" ? "Deleted" : "Modified"}
        {resource ? ` · ${resource}` : ""}
      </p>
      <p className="mt-0.5 text-[11px] text-zinc-500">
        Actor: {actor}
        {region !== "—" && <> · {region}</>}
      </p>
    </li>
  );
}

export function InfrastructureEventsList({
  accountId,
  onDate,
  count,
  defaultExpanded = false,
}: {
  accountId: string;
  onDate: string;
  count: number;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const { data, isLoading, error } = useQuery<{ events: InfraEvent[] }>({
    queryKey: ["timeline-day", accountId, onDate],
    queryFn: () =>
      api<{ events: InfraEvent[] }>(
        `/v1/accounts/${accountId}/timeline?on_date=${onDate}&limit=50&days=90`,
        { schema: accountTimelineSchema as unknown as z.ZodType<{ events: InfraEvent[] }> },
      ),
    enabled: expanded && !!accountId,
  });

  if (count === 0) {
    return (
      <p className="text-xs text-zinc-500">No infrastructure write events recorded on this day.</p>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
      >
        <span>Infrastructure events: {count}</span>
        <svg
          className={`h-4 w-4 shrink-0 text-zinc-400 transition ${expanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-zinc-200 px-3 pb-3 pt-2">
          {isLoading && <p className="text-xs text-zinc-500">Loading events…</p>}
          {error && <p className="text-xs text-red-600">Could not load events.</p>}
          {data && (
            <ul className="mt-1 max-h-64 space-y-2 overflow-y-auto">
              {data.events.length === 0 ? (
                <li className="text-xs text-zinc-500">No events on this day.</li>
              ) : (
                data.events.map((evt) => <InfraEventRow key={evt.event_id} evt={evt} />)
              )}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-zinc-400">
            CloudTrail writes from scans (IAM, S3, EC2, KMS, …). Supporting context for compliance changes.
          </p>
        </div>
      )}
    </div>
  );
}
