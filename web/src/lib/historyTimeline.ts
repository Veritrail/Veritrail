import type { HistoryEvent } from "./complianceHistory";

export type HistoryDayGroup = {
  day: string;
  label: string;
  events: HistoryEvent[];
};

export function groupEventsByDay(events: HistoryEvent[]): HistoryDayGroup[] {
  const map = new Map<string, HistoryEvent[]>();
  for (const event of events) {
    const day = event.timestamp.slice(0, 10);
    const bucket = map.get(day);
    if (bucket) bucket.push(event);
    else map.set(day, [event]);
  }
  return Array.from(map.entries()).map(([day, dayEvents]) => ({
    day,
    label: new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    events: dayEvents,
  }));
}

export function sumFindingsResolvedInPeriod(events: HistoryEvent[]): number {
  return events.reduce((sum, e) => sum + (e.findings_resolved ?? 0), 0);
}
