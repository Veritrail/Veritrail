// Org-first readiness home — default `/accounts` view (spec: docs/org-readiness-home.md).
// Answers "is the company audit ready and what blocks it" org-wide; accounts stay drill-downs.
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import {
  complianceTimelineSchema,
  controlListSchema,
  integrationStatusNullableSchema,
} from "../lib/apiSchemas";
import { fetchAllFindings } from "../lib/fetchAllFindings";
import type { ComplianceHistoryResponse, HistoryEvent } from "../lib/complianceHistory";
import { historyDetailLine, historyTypeDisplay } from "../lib/historyEvidence";
import {
  defaultOrgFindingsHref,
  findingsHrefForCheckIds,
  type FindingsProviderScope,
  useConnectedAccountOptions,
} from "../hooks/useConnectedAccountOptions";
import { labelForCheck } from "../data/checkLabels";
import { CHECK_CONTROL_IDS_MAP } from "../data/checkControlIdsMap";

type OrgFinding = {
  id: string;
  check_id: string;
  severity: string;
  status: string;
};

type BlockerGroup = {
  checkId: string;
  count: number;
  /** Deduped SOC 2 control ids this check maps to (blocked while findings stay open). */
  soc2ControlIds: string[];
};

const STEP_LABELS = [
  "Connected",
  "Evidence flowing",
  "Fix high findings",
  "Controls passing",
  "Audit ready",
] as const;

/** Open findings that count toward N — same severities as Findings severity chips. */
function isHighSeverity(severity: string): boolean {
  return severity === "critical" || severity === "high";
}

/** Query keys aligned with FindingsWorkspace so findings invalidation keeps N fresh. */
function orgScopeFindingsQueryKey(provider: FindingsProviderScope) {
  const scopeParams = { provider };
  return ["findings", "open", "", scopeParams, provider] as const;
}

function soc2ControlIdsForCheck(checkId: string): string[] {
  const refs = CHECK_CONTROL_IDS_MAP[checkId] ?? [];
  const ids: string[] = [];
  for (const ref of refs) {
    if (ref.framework === "soc2" && !ids.includes(ref.control_id)) ids.push(ref.control_id);
  }
  return ids;
}

/** Org-level source tag for the blocker meta line; cloud checks carry no tag. */
function sourceTagForCheck(checkId: string): string | null {
  if (checkId.startsWith("github.")) return "GitHub";
  if (checkId.startsWith("gitlab.")) return "GitLab";
  if (checkId.startsWith("entra.")) return "Entra ID";
  if (checkId.startsWith("google_workspace.")) return "Google Workspace";
  return null;
}

/** "CC6.1" / "CC6.1 and CC6.2" / "CC6.1, CC6.2 and CC6.3" / cap 3 + "and more". */
function formatControlList(ids: string[]): string {
  if (ids.length === 0) return "";
  if (ids.length === 1) return ids[0];
  if (ids.length === 2) return `${ids[0]} and ${ids[1]}`;
  if (ids.length === 3) return `${ids[0]}, ${ids[1]} and ${ids[2]}`;
  return `${ids[0]}, ${ids[1]}, ${ids[2]} and more`;
}

function itemsPhrase(groupCount: number): string {
  if (groupCount === 1) return "the item below";
  if (groupCount === 2) return "the two items below";
  return "the three items below";
}

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

export function OrgReadinessHome() {
  const { options: connectedAccounts, isSuccess: accountsReady } = useConnectedAccountOptions();

  // Integration presence — same queries/keys as the Findings page so the caches are shared.
  const githubQ = useQuery({
    queryKey: ["github-provider"],
    queryFn: () => api("/v1/integrations/github", { schema: integrationStatusNullableSchema }),
    staleTime: 300_000,
  });
  const gitlabQ = useQuery({
    queryKey: ["gitlab-provider"],
    queryFn: () => api("/v1/integrations/gitlab", { schema: integrationStatusNullableSchema }),
    staleTime: 300_000,
  });
  const entraQ = useQuery({
    queryKey: ["integration", "entra"],
    queryFn: () => api("/v1/integrations/entra", { schema: integrationStatusNullableSchema }),
    staleTime: 300_000,
  });
  const googleWorkspaceQ = useQuery({
    queryKey: ["integration", "google-workspace"],
    queryFn: () => api("/v1/integrations/google-workspace", { schema: integrationStatusNullableSchema }),
    staleTime: 300_000,
  });
  const hasGithub = !!githubQ.data;
  const hasGitlab = !!gitlabQ.data;
  const hasSourceControl = hasGithub || hasGitlab;
  const hasIdentity = !!entraQ.data || !!googleWorkspaceQ.data;
  const integrationsReady =
    githubQ.isFetched && gitlabQ.isFetched && entraQ.isFetched && googleWorkspaceQ.isFetched;

  const hasCloudAccounts = connectedAccounts.length >= 1;

  // Org-wide open findings: three explicitly scoped fetches merged + de-duped by id.
  // Unscoped `/v1/findings` also returns everything, but the UI must never rely on
  // "no filter" meaning "all org" (see docs/findings-scope-selector.md).
  const needsCloudFindings = accountsReady && hasCloudAccounts;
  const needsSourceFindings = integrationsReady && hasSourceControl;
  const needsIdentityFindings = integrationsReady && hasIdentity;

  const cloudFindingsQ = useQuery({
    queryKey: orgScopeFindingsQueryKey("all_cloud"),
    queryFn: () => fetchAllFindings<OrgFinding>({ status: "open", provider: "all_cloud" }),
    enabled: needsCloudFindings,
    refetchOnMount: "always",
  });
  const sourceControlFindingsQ = useQuery({
    queryKey: orgScopeFindingsQueryKey("source_control"),
    queryFn: () => fetchAllFindings<OrgFinding>({ status: "open", provider: "source_control" }),
    enabled: needsSourceFindings,
    refetchOnMount: "always",
  });
  const identityFindingsQ = useQuery({
    queryKey: orgScopeFindingsQueryKey("identity"),
    queryFn: () => fetchAllFindings<OrgFinding>({ status: "open", provider: "identity" }),
    enabled: needsIdentityFindings,
    refetchOnMount: "always",
  });

  // Org-level SOC 2 grading — no account_id; the route grades the org including
  // org integrations (api/app/routes/controls.py list_controls).
  const controlsQ = useQuery({
    queryKey: ["controls", "soc2", "org-readiness"],
    queryFn: () => api("/v1/controls?framework=soc2", { schema: controlListSchema }),
  });

  const awsAccounts = useMemo(
    () => connectedAccounts.filter((account) => account.provider === "aws"),
    [connectedAccounts],
  );

  // Timeline: the compliance-timeline endpoint is AWS-account-scoped today, so we
  // merge the streams client-side (org-level endpoint intentionally not built — spec §4).
  const timelineQs = useQueries({
    queries: awsAccounts.map((account) => ({
      queryKey: ["org-readiness", "timeline", account.id],
      queryFn: () =>
        api<ComplianceHistoryResponse>(
          `/v1/accounts/${account.id}/compliance-timeline?framework=soc2&days=14&limit=10`,
          { schema: complianceTimelineSchema },
        ),
      enabled: !!account.last_scan_at,
      staleTime: 60_000,
    })),
  });

  const openFindings = useMemo(() => {
    const byId = new Map<string, OrgFinding>();
    for (const q of [cloudFindingsQ.data, sourceControlFindingsQ.data, identityFindingsQ.data]) {
      for (const finding of q?.items ?? []) byId.set(finding.id, finding);
    }
    return [...byId.values()];
  }, [cloudFindingsQ.data, sourceControlFindingsQ.data, identityFindingsQ.data]);

  const highFindings = useMemo(() => openFindings.filter((f) => isHighSeverity(f.severity)), [openFindings]);
  const highCount = highFindings.length;

  // Blocker groups: org-wide open critical|high findings grouped by check_id.
  // Ranking (deterministic): most SOC 2 controls blocked first, then most findings,
  // then check_id A→Z as a stable tiebreak. Top 3 only.
  const blockerGroups = useMemo<BlockerGroup[]>(() => {
    const counts = new Map<string, number>();
    for (const finding of highFindings) {
      counts.set(finding.check_id, (counts.get(finding.check_id) ?? 0) + 1);
    }
    const groups: BlockerGroup[] = [...counts.entries()].map(([checkId, count]) => ({
      checkId,
      count,
      soc2ControlIds: soc2ControlIdsForCheck(checkId),
    }));
    groups.sort(
      (a, b) =>
        b.soc2ControlIds.length - a.soc2ControlIds.length ||
        b.count - a.count ||
        a.checkId.localeCompare(b.checkId),
    );
    return groups.slice(0, 3);
  }, [highFindings]);

  // Headline math: X = findings cleared by fixing the top blocker groups;
  // unblocked controls = union of their SOC 2 control ids.
  const clearedByBlockers = useMemo(
    () => blockerGroups.reduce((sum, group) => sum + group.count, 0),
    [blockerGroups],
  );
  const unblockedControlIds = useMemo(() => {
    const ids: string[] = [];
    for (const group of blockerGroups) {
      for (const id of group.soc2ControlIds) {
        if (!ids.includes(id)) ids.push(id);
      }
    }
    return ids.sort();
  }, [blockerGroups]);

  const controlsSummary = useMemo(() => {
    const rows = controlsQ.data ?? [];
    return {
      total: rows.length,
      passed: rows.filter((row) => row.status === "pass").length,
      failing: rows.filter((row) => row.status === "fail").length,
      graded: rows.some((row) => row.status !== "no_data"),
    };
  }, [controlsQ.data]);

  // Stepper state (org-wide) — current step is the first incomplete one.
  const anyScanCompleted = connectedAccounts.some((account) => !!account.last_scan_at);
  const stepDone: boolean[] = [
    // 1. Connected: ≥1 connected cloud account OR any integration connected.
    hasCloudAccounts || hasSourceControl || hasIdentity,
    // 2. Evidence flowing: a completed scan, org grading data, or org findings exist.
    anyScanCompleted || controlsSummary.graded || openFindings.length > 0,
    // 3. Fix high findings: current while N > 0.
    highCount === 0,
    // 4. Controls passing: current while N == 0 and passed < total.
    controlsSummary.total > 0 && controlsSummary.passed === controlsSummary.total,
    // 5. Audit ready.
    controlsSummary.total > 0 && controlsSummary.passed === controlsSummary.total,
  ];
  const currentStep = stepDone.findIndex((done) => !done);

  const findingsLoading =
    (needsCloudFindings && cloudFindingsQ.isPending) ||
    (needsSourceFindings && sourceControlFindingsQ.isPending) ||
    (needsIdentityFindings && identityFindingsQ.isPending);
  const loading =
    !accountsReady || !integrationsReady || findingsLoading || controlsQ.isPending;

  const timelineEvents = useMemo(() => {
    const events: HistoryEvent[] = [];
    for (const q of timelineQs) {
      for (const event of q.data?.events ?? []) {
        if (event.type === "baseline_established") continue;
        events.push(event);
      }
    }
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return events.slice(0, 6);
  }, [timelineQs]);

  if (loading) {
    return (
      <div className="org-home" aria-busy="true">
        <div className="org-home__skeleton org-home__skeleton--headline" />
        <div className="org-home__skeleton org-home__skeleton--subline" />
        <div className="org-home__skeleton org-home__skeleton--stepper" />
        <div className="org-home__skeleton org-home__skeleton--card" />
      </div>
    );
  }

  const zeroHigh = highCount === 0;

  // Audit-readiness verdict for the org: not ready while high findings remain
  // open or controls are failing; ready once every graded control passes;
  // otherwise (no highs, controls still pending) "almost".
  const verdict: "ready" | "almost" | "not-ready" =
    highCount > 0 || controlsSummary.failing > 0
      ? "not-ready"
      : controlsSummary.total > 0 && controlsSummary.passed === controlsSummary.total
        ? "ready"
        : "almost";
  const verdictPhrase =
    verdict === "ready" ? "audit ready" : verdict === "almost" ? "almost audit ready" : "not audit ready";

  return (
    <div className="org-home">
      <header className="org-home__headline-block">
        <p className={`org-home__verdict org-home__verdict--${verdict}`}>
          This company is <strong className="org-home__verdict-em">{verdictPhrase}</strong> for SOC 2.
        </p>
        {zeroHigh ? (
          <h1 className="org-home__headline">No high findings stand between you and SOC 2.</h1>
        ) : (
          <h1 className="org-home__headline">
            {highCount} <span className="org-home__headline-em">high finding{highCount === 1 ? "" : "s"}</span>{" "}
            stand{highCount === 1 ? "s" : ""} between you and SOC 2.
          </h1>
        )}
        {zeroHigh && controlsSummary.total > 0 ? (
          <p className="org-home__subline">
            {controlsSummary.passed} of {controlsSummary.total} controls passing — keep evidence flowing.
          </p>
        ) : null}
      </header>

      <ol className="org-home__stepper" aria-label="Audit readiness progress">
        {STEP_LABELS.map((label, idx) => {
          const done = currentStep === -1 || idx < currentStep;
          const current = idx === currentStep;
          const prevDone = currentStep === -1 || idx <= currentStep;
          const state = done ? "is-done" : current ? "is-current" : "is-future";
          return (
            <li key={label} className={`org-home__step ${state}`} aria-current={current ? "step" : undefined}>
              {idx > 0 ? (
                <span className={`org-home__step-line${prevDone ? " is-reached" : ""}`} aria-hidden />
              ) : null}
              <span className="org-home__step-dot" aria-hidden />
              <span className="org-home__step-label">{label}</span>
            </li>
          );
        })}
      </ol>

      {!zeroHigh && blockerGroups.length > 0 ? (
        <section className="org-home__blockers-section" aria-label="What's blocking you">
          <h2 className="org-home__section-title">What's blocking you</h2>
          <div className="org-home__section-intro-row">
            <p className="org-home__section-intro">
              Fixing {itemsPhrase(blockerGroups.length)} clears {clearedByBlockers} of {highCount} high finding
              {highCount === 1 ? "" : "s"}
              {unblockedControlIds.length > 0 ? ` and unblocks ${formatControlList(unblockedControlIds)}` : ""}.
              Everything else can wait.
            </p>
            <Link
              to={defaultOrgFindingsHref({ hasCloudAccounts, hasSourceControl, hasIdentity })}
              className="org-home__section-link"
            >
              All findings <span aria-hidden>→</span>
            </Link>
          </div>
          <div className="org-home__blockers-card">
            {blockerGroups.map((group) => {
              const sourceTag = sourceTagForCheck(group.checkId);
              const metaParts = [
                `${group.count} finding${group.count === 1 ? "" : "s"}`,
                ...(group.soc2ControlIds.length > 0 ? [group.soc2ControlIds.join(", ")] : []),
                ...(sourceTag ? [sourceTag] : []),
              ];
              return (
                <div key={group.checkId} className="org-home__blocker-row">
                  <span className="org-home__high-chip">HIGH</span>
                  <div className="org-home__blocker-copy">
                    <p className="org-home__blocker-title">{labelForCheck(group.checkId)}</p>
                    <p className="org-home__blocker-meta">{metaParts.join(" · ")}</p>
                  </div>
                  <Link
                    to={findingsHrefForCheckIds([group.checkId]) ?? defaultOrgFindingsHref({ hasCloudAccounts, hasSourceControl, hasIdentity })}
                    className="org-home__review-btn"
                  >
                    Review <span aria-hidden>→</span>
                  </Link>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="org-home__timeline-section" aria-label="Timeline">
        <SectionHead title="Timeline" linkTo="/history" linkLabel="History" />
        {timelineEvents.length === 0 ? (
          <p className="org-home__timeline-empty">Activity appears after your first scan.</p>
        ) : (
          <ul className="org-home__timeline">
            {timelineEvents.map((event, idx) => (
              <li key={`${event.scan_run_id}-${event.timestamp}-${idx}`} className="org-home__timeline-row">
                <span className="org-home__timeline-time">{formatTimelineAgo(event.timestamp)}</span>
                <span
                  className={`org-home__timeline-dot${timelineDotIsGreen(event) ? " is-green" : ""}`}
                  aria-hidden
                />
                <span className="org-home__timeline-text">{timelineEventText(event)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
