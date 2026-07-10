// Org-first readiness home — default `/accounts` view (spec: docs/org-readiness-home.md).
// Answers "is the company's technical evidence ready and what blocks it" org-wide.
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
  assertBlockerMath,
  clearedByBlockers,
  formatControlList,
  groupBlockerFindings,
  isHighSeverity,
  itemsPhrase,
  partitionBlockerFindings,
  unblockedControlIds,
  type BlockerFinding,
} from "../lib/orgReadinessBlockers";
import {
  defaultOrgFindingsHref,
  findingsHrefForCheckIds,
  type FindingsProviderScope,
  useConnectedAccountOptions,
} from "../hooks/useConnectedAccountOptions";
import { useMe } from "../hooks/useMe";
import { BlockersList } from "./BlockersList";
import { CapabilitiesToEnableList } from "./CapabilitiesToEnableList";
import { absenceGapEnableItems } from "../lib/evidenceGap";

const STEP_LABELS = [
  "Connected",
  "Evidence flowing",
  "Fix high findings",
  "Controls passing",
  "Evidence ready",
] as const;

/** Query keys aligned with FindingsWorkspace so findings invalidation keeps N fresh. */
function orgScopeFindingsQueryKey(provider: FindingsProviderScope) {
  const scopeParams = { provider };
  return ["findings", "open", "", scopeParams, provider] as const;
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
  const meQ = useMe();
  const orgName = meQ.data?.org_name?.trim() || "Your company";

  const { options: connectedAccounts, isSuccess: accountsReady } = useConnectedAccountOptions();

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
  const hasAnyConnection = hasCloudAccounts || hasSourceControl || hasIdentity;

  const needsCloudFindings = accountsReady && hasCloudAccounts;
  const needsSourceFindings = integrationsReady && hasSourceControl;
  const needsIdentityFindings = integrationsReady && hasIdentity;

  const cloudFindingsQ = useQuery({
    queryKey: orgScopeFindingsQueryKey("all_cloud"),
    queryFn: () => fetchAllFindings<BlockerFinding>({ status: "open", provider: "all_cloud" }),
    enabled: needsCloudFindings,
    refetchOnMount: "always",
  });
  const sourceControlFindingsQ = useQuery({
    queryKey: orgScopeFindingsQueryKey("source_control"),
    queryFn: () => fetchAllFindings<BlockerFinding>({ status: "open", provider: "source_control" }),
    enabled: needsSourceFindings,
    refetchOnMount: "always",
  });
  const identityFindingsQ = useQuery({
    queryKey: orgScopeFindingsQueryKey("identity"),
    queryFn: () => fetchAllFindings<BlockerFinding>({ status: "open", provider: "identity" }),
    enabled: needsIdentityFindings,
    refetchOnMount: "always",
  });

  const controlsQ = useQuery({
    queryKey: ["controls", "soc2", "org-readiness"],
    queryFn: () => api("/v1/controls?framework=soc2", { schema: controlListSchema }),
  });

  const awsAccounts = useMemo(
    () => connectedAccounts.filter((account) => account.provider === "aws"),
    [connectedAccounts],
  );

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
    const byId = new Map<string, BlockerFinding>();
    for (const q of [cloudFindingsQ.data, sourceControlFindingsQ.data, identityFindingsQ.data]) {
      for (const finding of q?.items ?? []) byId.set(finding.id, finding);
    }
    return [...byId.values()];
  }, [cloudFindingsQ.data, sourceControlFindingsQ.data, identityFindingsQ.data]);

  const highFindings = useMemo(() => openFindings.filter((f) => isHighSeverity(f.severity)), [openFindings]);
  const highCount = highFindings.length;
  const { blockerFindings, absenceGapFindings } = useMemo(
    () => partitionBlockerFindings(highFindings),
    [highFindings],
  );
  const blockerGroups = useMemo(() => groupBlockerFindings(blockerFindings), [blockerFindings]);
  const clearedByBlockersCount = clearedByBlockers(blockerGroups);
  const unblockedControlIdsList = unblockedControlIds(blockerGroups);
  const capabilityItems = useMemo(() => {
    const findingCountByCheck = new Map<string, number>();
    for (const finding of absenceGapFindings) {
      findingCountByCheck.set(
        finding.check_id,
        (findingCountByCheck.get(finding.check_id) ?? 0) + 1,
      );
    }
    return absenceGapEnableItems([...findingCountByCheck.keys()], findingCountByCheck);
  }, [absenceGapFindings]);

  if (import.meta.env.DEV && (blockerGroups.length > 0 || absenceGapFindings.length > 0)) {
    assertBlockerMath(highCount, blockerGroups, { absenceGapCount: absenceGapFindings.length });
  }

  const controlsSummary = useMemo(() => {
    const rows = controlsQ.data ?? [];
    return {
      total: rows.length,
      passed: rows.filter((row) => row.status === "pass").length,
      failing: rows.filter((row) => row.status === "fail").length,
      graded: rows.some((row) => row.status !== "no_data"),
    };
  }, [controlsQ.data]);

  const anyScanCompleted = connectedAccounts.some((account) => !!account.last_scan_at);
  const stepDone: boolean[] = [
    hasAnyConnection,
    anyScanCompleted || controlsSummary.graded || openFindings.length > 0,
    highCount === 0,
    controlsSummary.total > 0 && controlsSummary.passed === controlsSummary.total,
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

  const defaultFindingsHref = defaultOrgFindingsHref({ hasCloudAccounts, hasSourceControl, hasIdentity });
  const findingsHref = (checkId: string) => findingsHrefForCheckIds([checkId]) ?? defaultFindingsHref;

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

  if (!hasAnyConnection) {
    return (
      <div className="org-home">
        <header className="org-home__headline-block">
          <p className="org-home__verdict org-home__verdict--not-ready">
            {orgName} technical evidence is{" "}
            <strong className="org-home__verdict-em">not ready</strong> for SOC 2.
          </p>
          <h1 className="org-home__headline">Connect your first integration to get started.</h1>
          <p className="org-home__subline org-home__subline--scope">
            Veritrail collects the technical evidence for SOC 2 — cloud, identity, and source control.
          </p>
        </header>
        <p className="org-home__timeline-empty">
          <Link to="/integrations" className="org-home__section-link">
            Go to Integrations <span aria-hidden>→</span>
          </Link>
        </p>
      </div>
    );
  }

  const zeroHigh = highCount === 0;
  const evidenceReady =
    controlsSummary.total > 0 && controlsSummary.passed === controlsSummary.total && zeroHigh;
  const verdictClass = evidenceReady ? "ready" : "not-ready";

  return (
    <div className="org-home">
      <header className="org-home__headline-block">
        <p className={`org-home__verdict org-home__verdict--${verdictClass}`}>
          {orgName} technical evidence is{" "}
          <strong className="org-home__verdict-em">{evidenceReady ? "ready" : "not ready"}</strong>{" "}
          for SOC 2.
        </p>
        {zeroHigh ? (
          <h1 className="org-home__headline">No high findings stand between you and SOC 2.</h1>
        ) : (
          <h1 className="org-home__headline">
            {highCount}{" "}
            <span className="org-home__headline-em">
              high finding{highCount === 1 ? "" : "s"}
            </span>{" "}
            stand{highCount === 1 ? "s" : ""} between you and SOC 2.
          </h1>
        )}
        {zeroHigh && controlsSummary.total > 0 ? (
          <p className="org-home__subline">
            {controlsSummary.passed} of {controlsSummary.total} controls passing — keep evidence flowing.
          </p>
        ) : null}
        {!zeroHigh && blockerGroups.length > 0 ? (
          <p className="org-home__subline">
            Fixing {itemsPhrase(blockerGroups.length)} clears {clearedByBlockersCount} of {highCount} high finding
            {highCount === 1 ? "" : "s"}
            {unblockedControlIdsList.length > 0
              ? ` and unblocks ${formatControlList(unblockedControlIdsList)}`
              : ""}
            . Everything else can wait.
          </p>
        ) : null}
      </header>

      <ol className="org-home__stepper" aria-label="Evidence readiness progress">
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

      <p className="org-home__scope-note">
        Veritrail covers technical evidence across infrastructure, identity, and SDLC.
      </p>

      {!zeroHigh && blockerGroups.length > 0 ? (
        <section className="org-home__blockers-section" aria-label="What's blocking you">
          <div className="org-home__section-head">
            <h2 className="org-home__section-title">What&apos;s blocking you</h2>
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
      ) : null}

      {capabilityItems.length > 0 ? (
        <section className="org-home__capabilities-section" aria-label="Capabilities to turn on">
          <h2 className="org-home__section-title">Capabilities to turn on</h2>
          <CapabilitiesToEnableList items={capabilityItems} />
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
