import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { auditReadinessSchema } from "../lib/apiSchemas";
import { FRAMEWORKS, frameworkLabel } from "../data/frameworks";
import { findingsHrefForCheckIds } from "../hooks/useConnectedAccountOptions";
import { absenceGapCapabilityName, absenceGapConsoleUrl, isAbsenceGapCheck } from "../lib/evidenceGap";
import "../styles/audit-readiness-page.css";

const STATUS_LABELS: Record<string, string> = {
  supported: "Supported",
  partially_supported: "Partially supported",
  not_affirmed: "Not affirmed",
  not_applicable: "Not applicable",
};

function statusTone(status: string): string {
  if (status === "supported") return "supported";
  if (status === "partially_supported") return "partial";
  if (status === "not_applicable") return "not-applicable";
  return "not-affirmed";
}

function domainExportText(domain: {
  label: string;
  status: string;
  assertion_text: string;
  temporal_sentence?: string | null;
  coverage_line: string;
  control_tags: string[];
  named_sources?: string[];
}): string {
  const lines = [
    domain.label,
    STATUS_LABELS[domain.status] ?? domain.status,
    domain.assertion_text,
    domain.temporal_sentence ?? null,
    domain.named_sources?.length ? `Sources: ${domain.named_sources.join("; ")}` : null,
    domain.coverage_line,
    domain.control_tags.length ? `Controls: ${domain.control_tags.join(", ")}` : null,
  ].filter(Boolean);
  return lines.join("\n\n");
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
    const d = new Date(data.as_of);
    return Number.isFinite(d.getTime())
      ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : data.as_of;
  }, [data?.as_of]);

  const copyDomain = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const exportAll = () => {
    if (!data) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            framework: data.framework,
            org_name: data.org_name,
            as_of: data.as_of,
            period_days: data.period_days,
            scope_label: data.scope_label,
            domains: data.domains,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-readiness-${framework}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="audit-readiness">
      <header className="audit-readiness__header">
        <div>
          <h1 className="audit-readiness__title">Audit readiness</h1>
          <p className="audit-readiness__lede">
            A concrete checklist of what is active, what needs attention, and the audit controls each
            capability supports.
          </p>
        </div>
        <div className="audit-readiness__toolbar">
          <select
            className="audit-readiness__select"
            value={framework}
            onChange={(e) => setFramework(e.target.value)}
            aria-label="Framework"
          >
            {FRAMEWORKS.map((fw) => (
              <option key={fw.id} value={fw.id}>
                {fw.label}
              </option>
            ))}
          </select>
          <button type="button" className="audit-readiness__btn" disabled={!data} onClick={exportAll}>
            Export JSON
          </button>
        </div>
      </header>

      {isLoading && <p className="audit-readiness__meta">Loading audit checklist…</p>}
      {error && <p className="audit-readiness__error">Failed to load the audit checklist.</p>}

      {data && (
        <>
          <p className="audit-readiness__meta">
            {data.org_name} · {frameworkLabel(framework)} · {data.period_days}-day audit period
            {asOfLabel ? ` · as of ${asOfLabel}` : ""}
            {data.scope_label ? ` · scope: ${data.scope_label}` : ""}
          </p>

          {data.domains.length === 0 ? (
            <p className="audit-readiness__empty">
              No automated check evidence in scope yet. Connect cloud accounts or source-control
              integrations, then run a scan.
            </p>
          ) : (
            <div className="audit-readiness__domains">
              {data.domains.map((domain) => {
                const evidenceHref = findingsHrefForCheckIds(domain.check_ids ?? []);
                const complianceHref = `/controls?framework=${encodeURIComponent(framework)}`;
                const exportText = domainExportText(domain);
                return (
                  <article key={domain.key} className="audit-readiness__domain">
                    <div className="audit-readiness__domain-head">
                      <h2 className="audit-readiness__domain-title">{domain.label}</h2>
                      <span
                        className={`audit-readiness__status audit-readiness__status--${statusTone(domain.status)}`}
                      >
                        {STATUS_LABELS[domain.status] ?? domain.status}
                      </span>
                    </div>

                    <p className="audit-readiness__coverage">{domain.coverage_line}</p>

                    <div className="audit-readiness__checklist" role="list">
                      {domain.checklist_items.map((item) => {
                        const activateChecks = item.absence_check_ids.filter(isAbsenceGapCheck);
                        const reviewHref = findingsHrefForCheckIds(item.check_ids);
                        const rowStatus =
                          item.status === "verified"
                            ? "Verified"
                            : item.status === "not_applicable"
                              ? "Not applicable"
                              : "Action required";
                        return (
                          <div
                            key={item.key}
                            className={`audit-readiness__row audit-readiness__row--${item.status}`}
                            role="listitem"
                          >
                            <span
                              className="audit-readiness__row-icon"
                              aria-label={rowStatus}
                              title={rowStatus}
                            >
                              {item.status === "verified" ? "✓" : item.status === "not_applicable" ? "—" : "!"}
                            </span>
                            <div className="audit-readiness__row-main">
                              <span className="audit-readiness__row-label">
                                {item.label}
                                <span className="audit-readiness__row-state">{rowStatus}</span>
                              </span>
                              <span className="audit-readiness__row-summary">
                                {item.status === "not_applicable"
                                  ? item.applicability_reason
                                  : item.status === "verified"
                                    ? item.exception_count > 0
                                      ? `No open gaps · ${item.exception_count} documented exception${item.exception_count === 1 ? "" : "s"}`
                                      : "Active and no unresolved findings"
                                    : activateChecks.length > 0
                                      ? "Required capability is not active"
                                      : `${item.finding_count} unresolved finding${item.finding_count === 1 ? "" : "s"}${item.highest_severity ? ` · highest: ${item.highest_severity}` : ""}`}
                              </span>
                              {item.top_findings.length > 0 ? (
                                <span className="audit-readiness__row-findings">
                                  {item.top_findings.map((finding) => (
                                    <span key={`${finding.title}-${finding.resource}`}>
                                      <strong>{finding.severity}</strong> {finding.title}{finding.resource ? ` · ${finding.resource}` : ""}
                                    </span>
                                  ))}
                                </span>
                              ) : null}
                              {item.sources.length > 0 ? (
                                <span className="audit-readiness__row-source">
                                  {item.sources.slice(0, 3).join(" · ")}
                                </span>
                              ) : null}
                            </div>
                            <div className="audit-readiness__row-controls" aria-label="Mapped controls">
                              {item.controls.map((control) => (
                                <span key={control} className="audit-readiness__tag">{control}</span>
                              ))}
                            </div>
                            {item.status === "action" && activateChecks.length > 0 ? (
                              <span className="audit-readiness__row-actions">
                                {activateChecks.map((checkId) => {
                                  const href = absenceGapConsoleUrl(checkId);
                                  return href ? (
                                    <a key={checkId} className="audit-readiness__row-action" href={href} target="_blank" rel="noreferrer">
                                      Activate {absenceGapCapabilityName(checkId)}
                                    </a>
                                  ) : null;
                                })}
                                {reviewHref ? <Link className="audit-readiness__row-action audit-readiness__row-action--muted" to={reviewHref}>Review findings</Link> : null}
                              </span>
                            ) : item.status === "action" && reviewHref ? (
                              <Link className="audit-readiness__row-action" to={reviewHref}>Review</Link>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    {(domain.temporal_sentence || domain.scope_note) ? (
                      <div className="audit-readiness__notes">
                        {domain.temporal_sentence ? <span>{domain.temporal_sentence}</span> : null}
                        {domain.scope_note ? <span>{domain.scope_note}</span> : null}
                      </div>
                    ) : null}

                    <details className="audit-readiness__narrative">
                      <summary>Show auditor narrative</summary>
                      <p>{domain.assertion_text}</p>
                    </details>

                    <div className="audit-readiness__actions">
                      {evidenceHref ? (
                        <Link to={evidenceHref} className="audit-readiness__link">
                          View evidence
                        </Link>
                      ) : null}
                      <Link to={complianceHref} className="audit-readiness__link audit-readiness__link--muted">
                        Compliance mapping
                      </Link>
                      <button
                        type="button"
                        className="audit-readiness__copy"
                        onClick={() => copyDomain(domain.key, exportText)}
                      >
                        {copiedKey === domain.key ? "Copied" : "Copy for questionnaire"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
