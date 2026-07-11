import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { FRAMEWORKS, frameworkLabel } from "../data/frameworks";
import { findingsHrefForCheckIds } from "../hooks/useConnectedAccountOptions";
import { auditReadinessSchema } from "../lib/apiSchemas";
import "../styles/audit-readiness-page.css";

const STATUS_LABELS = {
  verified: "Verified",
  action: "Action needed",
  not_applicable: "Not applicable",
  not_assessed: "Not assessed",
} as const;

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
      <div className="audit-readiness__framework-card">
        <label className="audit-readiness__framework-label" htmlFor="audit-framework">
          Framework
        </label>
        <select
          id="audit-framework"
          className="audit-readiness__select"
          value={framework}
          onChange={(event) => setFramework(event.target.value)}
        >
          {FRAMEWORKS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <header className="audit-readiness__header">
        <div>
          <p className="audit-readiness__eyebrow">Technical evidence playbook</p>
          <h1 className="audit-readiness__title">Audit readiness</h1>
          <p className="audit-readiness__lede">
            Auditor-facing outcomes backed by configuration Veritrail can collect automatically.
          </p>
        </div>
      </header>

      <aside className="audit-readiness__scope">
        <strong>Automated scope only.</strong> Policy documents, runbooks, recovery exercises, and
        human process evidence are not marked verified here.
      </aside>

      {isLoading ? <p className="audit-readiness__meta">Loading technical playbooks…</p> : null}
      {error ? <p className="audit-readiness__error">Failed to load technical playbooks.</p> : null}

      {data ? (
        <>
          <p className="audit-readiness__meta">
            {data.org_name} · {frameworkLabel(framework)} · {data.period_days}-day audit period
            {asOfLabel ? ` · as of ${asOfLabel}` : ""}
            {data.scope_label ? ` · scope: ${data.scope_label}` : ""}
          </p>

          {data.playbooks.length === 0 ? (
            <p className="audit-readiness__empty">
              No automated technical evidence is in scope yet. Connect an integration and complete a
              scan.
            </p>
          ) : (
            <div className="audit-readiness__playbooks">
              {data.playbooks.map((playbook) => {
                const narratives = data.domains.filter((domain) =>
                  playbook.narrative_domain_keys.includes(domain.key),
                );
                const text = narrativeText(playbook.label, playbook.question, narratives);
                const priorityItems = playbook.items.filter((item) => item.status === "action");
                const secondaryItems = playbook.items.filter((item) => item.status !== "action");
                return (
                  <article key={playbook.key} className="audit-readiness__playbook">
                    <header className="audit-readiness__playbook-head">
                      <div>
                        <p className="audit-readiness__playbook-label">{playbook.label}</p>
                        <h2 className="audit-readiness__question">{playbook.question}</h2>
                        <p className="audit-readiness__outcome">{playbook.outcome}</p>
                      </div>
                      <span
                        className={`audit-readiness__status audit-readiness__status--${playbook.status}`}
                      >
                        {STATUS_LABELS[playbook.status]}
                      </span>
                    </header>

                    {priorityItems.length > 0 ? (
                      <div className="audit-readiness__checklist" role="list">
                        {priorityItems.map((item, index) => {
                          const reviewHref =
                            findingsHrefForCheckIds(item.check_ids) ?? "/integrations";
                          return (
                            <div
                              key={item.key}
                              className="audit-readiness__row"
                              role="listitem"
                            >
                              <span className="audit-readiness__row-rank" aria-hidden>
                                {index + 1}
                              </span>
                              <div className="audit-readiness__row-copy">
                                <div className="audit-readiness__row-heading">
                                  <span>{item.label}</span>
                                </div>
                                <p className="audit-readiness__row-summary">{item.summary}</p>
                                <p className="audit-readiness__row-meta">
                                  {item.finding_count} open finding
                                  {item.finding_count === 1 ? "" : "s"}
                                  {item.highest_severity
                                    ? ` · ${item.highest_severity} severity`
                                    : ""}
                                  {item.controls.length > 0
                                    ? ` · ${item.controls.slice(0, 2).join(", ")}`
                                    : ""}
                                </p>
                              </div>
                              {item.action_kind === "activate" && item.action_url ? (
                                <a
                                  className="audit-readiness__row-action"
                                  href={item.action_url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {item.action_label ?? "Enable"} <span aria-hidden>→</span>
                                </a>
                              ) : (
                                <Link className="audit-readiness__row-action" to={reviewHref}>
                                  {item.action_label ?? "Review"} <span aria-hidden>→</span>
                                </Link>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="audit-readiness__clear">
                        No priority actions from the currently collected evidence.
                      </p>
                    )}

                    {secondaryItems.length > 0 ? (
                      <details className="audit-readiness__secondary">
                        <summary>
                          Verified, not assessed, and out-of-scope checks ({secondaryItems.length})
                        </summary>
                        <div className="audit-readiness__secondary-list" role="list">
                          {secondaryItems.map((item) => (
                            <div
                              key={item.key}
                                className="audit-readiness__secondary-row"
                              role="listitem"
                            >
                              <span
                                className={`audit-readiness__secondary-state audit-readiness__secondary-state--${item.status}`}
                              >
                                {item.status === "verified" ? "✓" : "—"}
                              </span>
                              <div className="audit-readiness__row-copy">
                                <div className="audit-readiness__row-heading">
                                  <span>{item.label}</span>
                                  <span className="audit-readiness__row-state">
                                    {STATUS_LABELS[item.status]}
                                  </span>
                                </div>
                                <p className="audit-readiness__row-summary">{item.summary}</p>
                              </div>
                              <div
                                className="audit-readiness__row-controls"
                                aria-label="Control mapping"
                              >
                                {item.controls.slice(0, 3).map((control) => (
                                  <span key={control} className="audit-readiness__tag">
                                    {control}
                                  </span>
                                ))}
                                {item.controls.length > 3 ? (
                                  <span className="audit-readiness__tag">
                                    +{item.controls.length - 3}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}

                    {playbook.additional_action_count > 0 ? (
                      <p className="audit-readiness__remainder">
                        {playbook.additional_action_count} lower-priority action
                        {playbook.additional_action_count === 1 ? "" : "s"} summarized in the evidence
                        export.
                      </p>
                    ) : null}

                    <footer className="audit-readiness__footer">
                      {narratives.length > 0 ? (
                        <details className="audit-readiness__narrative">
                          <summary>Questionnaire / PDF narrative</summary>
                          {narratives.map((domain) => (
                            <p key={domain.key}>{domain.assertion_text}</p>
                          ))}
                        </details>
                      ) : (
                        <span />
                      )}
                      <div className="audit-readiness__footer-actions">
                        <Link
                          to={`/controls?framework=${encodeURIComponent(framework)}`}
                          className="audit-readiness__link audit-readiness__link--muted"
                        >
                          Control mapping
                        </Link>
                        {narratives.length > 0 ? (
                          <button
                            type="button"
                            className="audit-readiness__copy"
                            onClick={() => copyPlaybook(playbook.key, text)}
                          >
                            {copiedKey === playbook.key ? "Copied" : "Copy narrative"}
                          </button>
                        ) : null}
                      </div>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
