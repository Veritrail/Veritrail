import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ComplianceFrameworkSelect } from "../components/ComplianceFrameworkSelect";
import { HeaderFilterBar } from "../components/HeaderFilterBar";
import { HeaderSlot } from "../context/HeaderSlot";
import { frameworkLabel } from "../data/frameworks";
import { findingsHrefForCheckIds } from "../hooks/useConnectedAccountOptions";
import { auditReadinessSchema } from "../lib/apiSchemas";
import "../styles/audit-readiness-page.css";

const STATUS_LABELS = {
  verified: "Verified",
  action: "Action needed",
  not_applicable: "Not applicable",
  not_assessed: "Not assessed",
} as const;

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function narrativeText(
  label: string,
  question: string,
  domains: Array<{
    assertion_text: string;
    temporal_sentence?: string | null;
    coverage_line: string;
  }>,
): string {
  return [
    label,
    question,
    ...domains.flatMap((domain) => [
      domain.assertion_text,
      domain.temporal_sentence ?? null,
      domain.coverage_line,
    ]),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export default function AuditReadiness() {
  const [framework, setFramework] = useState("soc2");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["audit-readiness", framework],
    queryFn: () =>
      api(`/v1/audit-readiness?framework=${encodeURIComponent(framework)}`, {
        schema: auditReadinessSchema,
      }),
  });

  const asOfLabel = useMemo(() => {
    if (!data?.as_of) return null;
    const date = new Date(data.as_of);
    return Number.isFinite(date.getTime())
      ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : data.as_of;
  }, [data?.as_of]);

  const dashboard = useMemo(() => {
    if (!data) return null;
    const items = data.playbooks.flatMap((playbook, playbookOrder) =>
      playbook.items.map((item, itemOrder) => ({
        item,
        playbookKey: playbook.key,
        playbookLabel: playbook.label,
        playbookOrder,
        itemOrder,
      })),
    );
    const totalChecks = data.domains.reduce((total, domain) => total + domain.checks_total, 0);
    const passingChecks = data.domains.reduce(
      (total, domain) => total + domain.checks_passing,
      0,
    );
    const actionItems = items.filter(({ item }) => item.status === "action");
    const hiddenActions = data.playbooks.reduce(
      (total, playbook) => total + playbook.additional_action_count,
      0,
    );
    const areasNeedingAction = data.playbooks.filter(
      (playbook) => playbook.status === "action",
    ).length;
    const rankedActions = [...actionItems].sort((left, right) => {
      const severityDelta =
        (SEVERITY_RANK[left.item.highest_severity ?? ""] ?? 9) -
        (SEVERITY_RANK[right.item.highest_severity ?? ""] ?? 9);
      if (severityDelta !== 0) return severityDelta;
      if (left.playbookKey === "disaster_recovery" && right.playbookKey !== "disaster_recovery") {
        return -1;
      }
      if (right.playbookKey === "disaster_recovery" && left.playbookKey !== "disaster_recovery") {
        return 1;
      }
      return left.playbookOrder - right.playbookOrder || left.itemOrder - right.itemOrder;
    });
    const highestSeverity = rankedActions.find(({ item }) => item.highest_severity)?.item
      .highest_severity;

    return {
      passingChecks,
      totalChecks,
      actionCount: actionItems.length + hiddenActions,
      areasNeedingAction,
      highestSeverity,
      priorityActions: rankedActions
        .filter(({ playbookKey }) => playbookKey !== "disaster_recovery")
        .slice(0, 5),
      recovery: data.playbooks.find((playbook) => playbook.key === "disaster_recovery") ?? null,
    };
  }, [data]);

  const copyPlaybook = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 2000);
    } catch {
      // Clipboard access is optional; the page remains usable without it.
    }
  };

  return (
    <div className="audit-readiness">
      <HeaderSlot>
        <HeaderFilterBar>
          <ComplianceFrameworkSelect selectedId={framework} statsById={{}} onSelect={setFramework} />
        </HeaderFilterBar>
      </HeaderSlot>

      <header className="audit-readiness__header">
        <div>
          <h1 className="audit-readiness__title">Audit readiness</h1>
          <p className="audit-readiness__lede">
            A focused view of what needs attention, what is technically verified, and what remains
            outside automated scope.
          </p>
        </div>
        {data ? (
          <p className="audit-readiness__context">
            {frameworkLabel(framework)} · {data.period_days} days · {data.scope_label}
            {asOfLabel ? <span>Generated {asOfLabel}</span> : null}
          </p>
        ) : null}
      </header>

      {isLoading ? <p className="audit-readiness__loading">Loading audit readiness…</p> : null}
      {error ? <p className="audit-readiness__error">Failed to load audit readiness.</p> : null}

      {data && dashboard ? (
        data.playbooks.length === 0 ? (
          <p className="audit-readiness__empty">
            No automated technical evidence is in scope yet. Connect an integration and complete a
            scan.
          </p>
        ) : (
          <>
            <section className="audit-readiness__summary" aria-label="Readiness summary">
              <div className="audit-readiness__score">
                <span className="audit-readiness__score-value">
                  {dashboard.totalChecks > 0
                    ? `${dashboard.passingChecks} / ${dashboard.totalChecks}`
                    : "—"}
                </span>
                <span className="audit-readiness__metric-label">Automated checks passing</span>
                <span className="audit-readiness__metric-note">
                  Mapped technical checks in the selected framework
                </span>
              </div>
              <div className="audit-readiness__metric">
                <span className="audit-readiness__metric-value">{dashboard.actionCount}</span>
                <span className="audit-readiness__metric-label">Actions identified</span>
                <span className="audit-readiness__metric-note">Prioritized below</span>
              </div>
              <div className="audit-readiness__metric">
                <span className="audit-readiness__metric-value">
                  {dashboard.areasNeedingAction}
                </span>
                <span className="audit-readiness__metric-label">Areas needing work</span>
                <span className="audit-readiness__metric-note">
                  of {data.playbooks.length} evidence areas
                </span>
              </div>
              <div className="audit-readiness__metric">
                <span
                  className={`audit-readiness__metric-value audit-readiness__metric-value--${dashboard.highestSeverity ?? "none"}`}
                >
                  {dashboard.highestSeverity ?? "None"}
                </span>
                <span className="audit-readiness__metric-label">Highest visible severity</span>
                <span className="audit-readiness__metric-note">Across prioritized actions</span>
              </div>
            </section>

            <p className="audit-readiness__scope-note">
              <span aria-hidden>ⓘ</span>
              Automated evidence only. Policies, runbooks, recovery exercises, and human processes
              are not marked verified.
            </p>

            <div className="audit-readiness__focus-grid">
              <section className="audit-readiness__focus-card audit-readiness__focus-card--recovery">
                <header className="audit-readiness__section-head">
                  <div>
                    <p className="audit-readiness__section-kicker">Recovery readiness</p>
                    <h2>Can your data be restored?</h2>
                  </div>
                  {dashboard.recovery ? (
                    <span
                      className={`audit-readiness__status audit-readiness__status--${dashboard.recovery.status}`}
                    >
                      {STATUS_LABELS[dashboard.recovery.status]}
                    </span>
                  ) : null}
                </header>

                {!dashboard.recovery ? (
                  <p className="audit-readiness__quiet">
                    No mapped recovery checks are available for the selected framework.
                  </p>
                ) : dashboard.recovery.status === "not_assessed" ? (
                  <p className="audit-readiness__quiet">
                    Recovery evidence is not available from the latest completed inventory.
                  </p>
                ) : dashboard.recovery.status === "not_applicable" ? (
                  <p className="audit-readiness__quiet">
                    No applicable RDS, DynamoDB, or backup-eligible resources were found in scope.
                  </p>
                ) : dashboard.recovery.items.some((item) => item.status === "action") ? (
                  <div className="audit-readiness__action-list">
                    {dashboard.recovery.items
                      .filter((item) => item.status === "action")
                      .map((item) => {
                        const reviewHref = findingsHrefForCheckIds(item.check_ids) ?? "/integrations";
                        return (
                          <div key={item.key} className="audit-readiness__action-row">
                            <span className="audit-readiness__action-dot" aria-hidden />
                            <div className="audit-readiness__action-copy">
                              <strong>{item.label}</strong>
                              <span>{item.summary}</span>
                              <small>
                                {item.finding_count} finding{item.finding_count === 1 ? "" : "s"}
                                {item.controls.length > 0 ? ` · ${item.controls.slice(0, 2).join(", ")}` : ""}
                              </small>
                            </div>
                            {item.action_kind === "activate" && item.action_url ? (
                              <a className="audit-readiness__action-link" href={item.action_url} target="_blank" rel="noreferrer">
                                {item.action_label ?? "Enable"}
                              </a>
                            ) : (
                              <Link className="audit-readiness__action-link" to={reviewHref}>
                                {item.action_label ?? "Review"}
                              </Link>
                            )}
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <p className="audit-readiness__positive">
                    <span aria-hidden>✓</span> Collected recovery checks have no open technical gaps.
                  </p>
                )}
              </section>

              <section className="audit-readiness__focus-card">
                <header className="audit-readiness__section-head">
                  <div>
                    <p className="audit-readiness__section-kicker">Priority queue</p>
                    <h2>What should be addressed next?</h2>
                  </div>
                  <Link to="/findings" className="audit-readiness__text-link">All findings</Link>
                </header>

                {dashboard.priorityActions.length > 0 ? (
                  <div className="audit-readiness__priority-list">
                    {dashboard.priorityActions.map(({ item, playbookLabel }) => {
                      const reviewHref = findingsHrefForCheckIds(item.check_ids) ?? "/integrations";
                      return (
                        <div key={`${playbookLabel}-${item.key}`} className="audit-readiness__priority-row">
                          <span
                            className={`audit-readiness__severity audit-readiness__severity--${item.highest_severity ?? "medium"}`}
                          >
                            {item.highest_severity ?? "action"}
                          </span>
                          <div>
                            <strong>{item.label}</strong>
                            <span>{playbookLabel} · {item.finding_count} finding{item.finding_count === 1 ? "" : "s"}</span>
                          </div>
                          {item.action_kind === "activate" && item.action_url ? (
                            <a className="audit-readiness__chevron-link" href={item.action_url} target="_blank" rel="noreferrer" aria-label={`${item.action_label ?? "Enable"} ${item.label}`}>
                              →
                            </a>
                          ) : (
                            <Link className="audit-readiness__chevron-link" to={reviewHref} aria-label={`Review ${item.label}`}>
                              →
                            </Link>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="audit-readiness__positive">
                    <span aria-hidden>✓</span> No priority actions in the collected evidence.
                  </p>
                )}
              </section>
            </div>

            <section className="audit-readiness__coverage">
              <header className="audit-readiness__coverage-head">
                <div>
                  <p className="audit-readiness__section-kicker">Technical coverage</p>
                  <h2>Evidence areas</h2>
                </div>
                <p>Select an area to inspect checks, mappings, and auditor narrative.</p>
              </header>

              <div className="audit-readiness__area-grid">
                {data.playbooks.map((playbook) => {
                  const actions = playbook.items.filter((item) => item.status === "action");
                  const verified = playbook.items.filter((item) => item.status === "verified");
                  const excluded = playbook.items.filter(
                    (item) => item.status === "not_applicable" || item.status === "not_assessed",
                  );
                  const narratives = data.domains.filter((domain) =>
                    playbook.narrative_domain_keys.includes(domain.key),
                  );
                  const text = narrativeText(playbook.label, playbook.question, narratives);
                  return (
                    <details key={playbook.key} className="audit-readiness__area-card">
                      <summary>
                        <div className="audit-readiness__area-title-row">
                          <h3>{playbook.label}</h3>
                          <span
                            className={`audit-readiness__status audit-readiness__status--${playbook.status}`}
                          >
                            {STATUS_LABELS[playbook.status]}
                          </span>
                        </div>
                        <p>{playbook.question}</p>
                        <div className="audit-readiness__area-counts">
                          {actions.length + playbook.additional_action_count > 0 ? (
                            <span className="audit-readiness__area-count audit-readiness__area-count--action">
                              {actions.length + playbook.additional_action_count} action{actions.length + playbook.additional_action_count === 1 ? "" : "s"}
                            </span>
                          ) : null}
                          <span>{verified.length} verified</span>
                          {excluded.length > 0 ? <span>{excluded.length} outside scope</span> : null}
                        </div>
                        <span className="audit-readiness__area-expand" aria-hidden>⌄</span>
                      </summary>

                      <div className="audit-readiness__area-body">
                        <p className="audit-readiness__area-outcome">{playbook.outcome}</p>
                        <div className="audit-readiness__evidence-list" role="list">
                          {playbook.items.map((item) => {
                            const reviewHref = findingsHrefForCheckIds(item.check_ids) ?? "/integrations";
                            return (
                              <div key={item.key} className="audit-readiness__evidence-row" role="listitem">
                                <span
                                  className={`audit-readiness__evidence-state audit-readiness__evidence-state--${item.status}`}
                                  aria-hidden
                                >
                                  {item.status === "verified" ? "✓" : item.status === "action" ? "!" : "—"}
                                </span>
                                <div className="audit-readiness__evidence-copy">
                                  <strong>{item.label}</strong>
                                  <span>{item.summary}</span>
                                  <small>
                                    {item.status === "action" ? `${item.finding_count} open finding${item.finding_count === 1 ? "" : "s"}` : STATUS_LABELS[item.status]}
                                    {item.controls.length > 0 ? ` · ${item.controls.slice(0, 3).join(", ")}` : ""}
                                  </small>
                                </div>
                                {item.status === "action" ? (
                                  item.action_kind === "activate" && item.action_url ? (
                                    <a className="audit-readiness__action-link" href={item.action_url} target="_blank" rel="noreferrer">
                                      {item.action_label ?? "Enable"}
                                    </a>
                                  ) : (
                                    <Link className="audit-readiness__action-link" to={reviewHref}>
                                      {item.action_label ?? "Review"}
                                    </Link>
                                  )
                                ) : null}
                              </div>
                            );
                          })}
                        </div>

                        <footer className="audit-readiness__area-footer">
                          {narratives.length > 0 ? (
                            <details className="audit-readiness__narrative">
                              <summary>Auditor narrative</summary>
                              {narratives.map((domain) => <p key={domain.key}>{domain.assertion_text}</p>)}
                            </details>
                          ) : <span />}
                          <div>
                            <Link to={`/controls?framework=${encodeURIComponent(framework)}`} className="audit-readiness__text-link">
                              Control mapping
                            </Link>
                            {narratives.length > 0 ? (
                              <button type="button" className="audit-readiness__copy" onClick={() => copyPlaybook(playbook.key, text)}>
                                {copiedKey === playbook.key ? "Copied" : "Copy narrative"}
                              </button>
                            ) : null}
                          </div>
                        </footer>
                      </div>
                    </details>
                  );
                })}
              </div>
            </section>
          </>
        )
      ) : null}
    </div>
  );
}
