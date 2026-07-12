import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { AccountFilterDropdown } from "../components/AccountFilterDropdown";
import { ComplianceFrameworkSelect } from "../components/ComplianceFrameworkSelect";
import { HeaderFilterBar } from "../components/HeaderFilterBar";
import { HeaderSlot } from "../context/HeaderSlot";
import { frameworkLabel } from "../data/frameworks";
import { useConnectedAccountOptions } from "../hooks/useConnectedAccountOptions";
import { useSelectedAccountId } from "../hooks/useSelectedAccountId";
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
  const { options: connectedAccounts, isSuccess: accountsReady } = useConnectedAccountOptions();
  const awsAccounts = useMemo(
    () => connectedAccounts.filter((account) => account.provider === "aws"),
    [connectedAccounts],
  );
  const { accountId, setAccountId } = useSelectedAccountId(awsAccounts, accountsReady);
  const { data, isLoading, error } = useQuery({
    queryKey: ["audit-readiness", framework, accountId],
    queryFn: () =>
      api(`/v1/audit-readiness?framework=${encodeURIComponent(framework)}&account_id=${encodeURIComponent(accountId)}`, {
        schema: auditReadinessSchema,
      }),
    enabled: accountsReady && !!accountId,
  });

  const findingsHref = (checkIds: string[]): string => {
    const params = new URLSearchParams({ checks: checkIds.join(","), account_id: accountId });
    return `/findings?${params.toString()}`;
  };

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
    const verifiedItems = items.filter(({ item }) => item.status === "verified").length;

    return {
      passingChecks,
      totalChecks,
      actionCount: actionItems.length + hiddenActions,
      areasNeedingAction,
      verifiedItems,
      totalItems: items.length,
      priorityActions: rankedActions
        .filter(({ playbookKey }) => playbookKey !== "disaster_recovery")
        .slice(0, 5),
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
          {awsAccounts.length > 0 && accountId ? (
            <AccountFilterDropdown
              accounts={awsAccounts}
              value={accountId}
              onChange={setAccountId}
            />
          ) : null}
          <ComplianceFrameworkSelect selectedId={framework} statsById={{}} onSelect={setFramework} />
        </HeaderFilterBar>
      </HeaderSlot>

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
            <section className="audit-readiness__overview" aria-label="Readiness summary">
              <div className="audit-readiness__overview-main">
                <div className="audit-readiness__overview-heading">
                  <p className="audit-readiness__overview-kicker">Readiness brief</p>
                  <span className={`audit-readiness__overview-status ${dashboard.actionCount > 0 ? "is-action" : "is-clear"}`}>
                    {dashboard.actionCount > 0 ? "Needs attention" : "On track"}
                  </span>
                </div>
                <h1>{frameworkLabel(framework)} technical evidence</h1>
                <p className="audit-readiness__overview-copy">
                  {dashboard.actionCount > 0 ? (
                    <>
                      <strong>{dashboard.actionCount} prioritized action{dashboard.actionCount === 1 ? "" : "s"}</strong>{" "}
                      {dashboard.actionCount === 1 ? "remains" : "remain"} across {dashboard.areasNeedingAction} evidence area{dashboard.areasNeedingAction === 1 ? "" : "s"}. Start with the highest-impact work below.
                    </>
                  ) : (
                    <>No automated actions remain. Continue collecting evidence and completing manual verification.</>
                  )}
                </p>
              </div>

              <div className="audit-readiness__overview-progress">
                <div className="audit-readiness__progress-item">
                  <div className="audit-readiness__progress-head">
                    <span>Automated checks</span>
                    <strong>{dashboard.totalChecks > 0 ? `${dashboard.passingChecks} / ${dashboard.totalChecks}` : "—"}</strong>
                  </div>
                  <div
                    className="audit-readiness__progress-track"
                    role="progressbar"
                    aria-label="Automated checks passing"
                    aria-valuemin={0}
                    aria-valuemax={Math.max(dashboard.totalChecks, 1)}
                    aria-valuenow={dashboard.passingChecks}
                  >
                    <span
                      style={{ width: `${dashboard.totalChecks > 0 ? Math.round((dashboard.passingChecks / dashboard.totalChecks) * 100) : 0}%` }}
                    />
                  </div>
                  <p>{dashboard.totalChecks > 0 ? `${Math.round((dashboard.passingChecks / dashboard.totalChecks) * 100)}% passing` : "No mapped checks"}</p>
                </div>

                <div className="audit-readiness__progress-item audit-readiness__progress-item--verification">
                  <div className="audit-readiness__progress-head">
                    <span>Checklist verification</span>
                    <strong>{dashboard.totalItems > 0 ? `${dashboard.verifiedItems} / ${dashboard.totalItems}` : "—"}</strong>
                  </div>
                  <div
                    className="audit-readiness__progress-track"
                    role="progressbar"
                    aria-label="Checklist items verified"
                    aria-valuemin={0}
                    aria-valuemax={Math.max(dashboard.totalItems, 1)}
                    aria-valuenow={dashboard.verifiedItems}
                  >
                    <span
                      style={{ width: `${dashboard.totalItems > 0 ? Math.round((dashboard.verifiedItems / dashboard.totalItems) * 100) : 0}%` }}
                    />
                  </div>
                  <p>{dashboard.totalItems > 0 ? `${Math.round((dashboard.verifiedItems / dashboard.totalItems) * 100)}% verified` : "No checklist items"}</p>
                </div>
              </div>

              <p className="audit-readiness__scope-note">
                <span aria-hidden>ⓘ</span>
                Automated evidence only. Policies, runbooks, recovery exercises, and human processes
                are not marked verified.
              </p>
            </section>

            <div className="audit-readiness__focus-grid">
              <details className="audit-readiness__focus-card" open>
                <summary className="audit-readiness__section-head">
                  <div>
                    <p className="audit-readiness__section-kicker">Priority queue</p>
                    <h2>What should be addressed next?</h2>
                  </div>
                  <span className="audit-readiness__queue-summary">
                    <span className="audit-readiness__queue-count">
                      {dashboard.actionCount > 0
                        ? `${dashboard.actionCount} action${dashboard.actionCount === 1 ? "" : "s"} · top ${dashboard.priorityActions.length} shown`
                        : "No open actions"}
                    </span>
                    <svg className="audit-readiness__queue-chevron" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                    </svg>
                  </span>
                </summary>

                {dashboard.priorityActions.length > 0 ? (
                  <div className="audit-readiness__priority-list">
                    {dashboard.priorityActions.map(({ item, playbookLabel }, index) => {
                      const reviewHref = findingsHref(item.check_ids);
                      return (
                        <div key={`${playbookLabel}-${item.key}`} className="audit-readiness__priority-row">
                          <span className="audit-readiness__priority-rank" aria-label={`Priority ${index + 1}`}>
                            {index + 1}
                          </span>
                          <div>
                            <strong>{item.label}</strong>
                            <span>{playbookLabel} · {item.finding_count} finding{item.finding_count === 1 ? "" : "s"}</span>
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
                    <span aria-hidden>✓</span> No priority actions in the collected evidence.
                  </p>
                )}
              </details>
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
                            const reviewHref = findingsHref(item.check_ids);
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
