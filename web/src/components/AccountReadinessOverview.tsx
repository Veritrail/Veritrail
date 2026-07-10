import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { HistoryEvent } from "../lib/complianceHistory";
import { historyDetailLine, historyTypeDisplay } from "../lib/historyEvidence";
import { BlockersList } from "./BlockersList";
import {
  assertBlockerMath,
  clearedByBlockers,
  formatControlList,
  groupBlockerFindings,
  itemsPhrase,
  unblockedControlIds,
  type BlockerFinding,
} from "../lib/orgReadinessBlockers";
import { findingsHrefForCheckIds } from "../hooks/useConnectedAccountOptions";

type ScanTimelineRow = {
  key: string;
  timestamp: string;
  text: string;
  dotGreen?: boolean;
};

function formatTimelineAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function timelineEventText(event: HistoryEvent): string {
  const label = historyTypeDisplay(event).label;
  const detail = historyDetailLine(event);
  return detail ? `${label} — ${detail}` : label;
}

function timelineDotIsGreen(event: HistoryEvent): boolean {
  return event.type === "finding_resolved" || event.type === "compliance_improved";
}

function SectionHead({ title, linkTo, linkLabel }: { title: string; linkTo: string; linkLabel: string }) {
  return (
    <div className="org-home__section-head">
      <h2 className="org-home__section-title">{title}</h2>
      <Link to={linkTo} className="org-home__section-link">
        {linkLabel} <span aria-hidden>→</span>
      </Link>
    </div>
  );
}

export function AccountReadinessOverview({
  accountId,
  provider,
  findings,
  findingsLoading,
  hasScanned,
  historyEvents,
  scanTimelineRows,
}: {
  accountId: string;
  provider: "aws" | "gcp" | "azure";
  findings: BlockerFinding[] | undefined;
  findingsLoading?: boolean;
  hasScanned: boolean;
  historyEvents: HistoryEvent[];
  scanTimelineRows: ScanTimelineRow[];
}) {
  const blockerGroups = useMemo(() => groupBlockerFindings(findings ?? []), [findings]);
  const highCount = useMemo(
    () => (findings ?? []).filter((f) => f.severity === "critical" || f.severity === "high").length,
    [findings],
  );
  const cleared = clearedByBlockers(blockerGroups);
  const controlIds = unblockedControlIds(blockerGroups);

  if (import.meta.env.DEV && blockerGroups.length > 0) {
    assertBlockerMath(highCount, blockerGroups);
  }

  const defaultFindingsHref = `/findings?account_id=${encodeURIComponent(accountId)}`;
  const findingsHref = (checkId: string) => {
    const base = findingsHrefForCheckIds([checkId]);
    if (!base) return defaultFindingsHref;
    const url = new URL(base, window.location.origin);
    url.searchParams.set("account_id", accountId);
    return `${url.pathname}${url.search}`;
  };

  const timelineRows = useMemo(() => {
    const activityRows: ScanTimelineRow[] = historyEvents
      .filter((event) => event.type !== "baseline_established")
      .map((event) => ({
        key: `${event.scan_run_id}-${event.timestamp}`,
        timestamp: event.timestamp,
        text: timelineEventText(event),
        dotGreen: timelineDotIsGreen(event),
      }));
    const merged = [...scanTimelineRows, ...activityRows];
    merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const seen = new Set<string>();
    const unique: ScanTimelineRow[] = [];
    for (const row of merged) {
      if (seen.has(row.key)) continue;
      seen.add(row.key);
      unique.push(row);
    }
    return unique.slice(0, 6);
  }, [historyEvents, scanTimelineRows]);

  if (findingsLoading) {
    return (
      <div className="org-home org-home--account" aria-busy="true">
        <div className="org-home__skeleton org-home__skeleton--card" />
        <div className="org-home__skeleton org-home__skeleton--card" />
      </div>
    );
  }

  const zeroHigh = highCount === 0;

  return (
    <div className="org-home org-home--account">
      {!zeroHigh && blockerGroups.length > 0 ? (
        <section className="org-home__blockers-section" aria-label="What's blocking this account">
          <h2 className="org-home__section-title">What&apos;s blocking this account</h2>
          {blockerGroups.length > 0 ? (
            <p className="org-home__subline org-home__subline--blockers">
              Fixing {itemsPhrase(blockerGroups.length)} clears {cleared} of {highCount} high finding
              {highCount === 1 ? "" : "s"}
              {controlIds.length > 0 ? ` and unblocks ${formatControlList(controlIds)}` : ""}.
              Everything else can wait.
            </p>
          ) : null}
          <div className="org-home__section-head org-home__section-head--tight">
            <span />
            <Link to={defaultFindingsHref} className="org-home__section-link">
              All findings <span aria-hidden>→</span>
            </Link>
          </div>
          <BlockersList
            groups={blockerGroups}
            findingsHref={findingsHref}
            defaultFindingsHref={defaultFindingsHref}
          />
        </section>
      ) : (
        <section className="org-home__blockers-section" aria-label="What's blocking this account">
          <h2 className="org-home__section-title">What&apos;s blocking this account</h2>
          <p className="org-home__timeline-empty">
            {hasScanned ? "No high-severity findings for this account." : "Run a scan to surface blockers."}
          </p>
        </section>
      )}

      <section className="org-home__timeline-section" aria-label="Timeline">
        <SectionHead
          title="Timeline"
          linkTo={`/history?account_id=${encodeURIComponent(accountId)}`}
          linkLabel="History"
        />
        {timelineRows.length === 0 ? (
          <p className="org-home__timeline-empty">Activity appears after your first scan.</p>
        ) : (
          <ul className="org-home__timeline">
            {timelineRows.map((row) => (
              <li key={row.key} className="org-home__timeline-row">
                <span className="org-home__timeline-time">{formatTimelineAgo(row.timestamp)}</span>
                <span
                  className={`org-home__timeline-dot${row.dotGreen ? " is-green" : ""}`}
                  aria-hidden
                />
                <span className="org-home__timeline-text">{row.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function scanRowToTimelineText(
  succeeded: boolean,
  resourcesScanned?: number | null,
): string {
  if (!succeeded) return "Scan failed";
  const count = resourcesScanned ?? 0;
  return `Scan completed — ${count.toLocaleString()} resource${count === 1 ? "" : "s"}`;
}

// Re-export for Accounts.tsx scan row builder
export type { ScanTimelineRow };
