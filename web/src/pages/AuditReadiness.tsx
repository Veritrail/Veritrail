import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { auditReadinessSchema } from "../lib/apiSchemas";
import { FRAMEWORKS, frameworkLabel } from "../data/frameworks";
import { findingsHrefForCheckIds } from "../hooks/useConnectedAccountOptions";
import "../styles/audit-readiness-page.css";

const STATUS_LABELS: Record<string, string> = {
  supported: "Supported",
  partially_supported: "Partially supported",
  not_affirmed: "Not affirmed",
};

function statusTone(status: string): string {
  if (status === "supported") return "supported";
  if (status === "partially_supported") return "partial";
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
            Auditor-language capability assertions backed by collected evidence — the same narrative
            builder that powers your evidence pack PDF.
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

      {isLoading && <p className="audit-readiness__meta">Loading narrative…</p>}
      {error && <p className="audit-readiness__error">Failed to load audit readiness narrative.</p>}

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
                const evidenceHref = findingsHrefForCheckIds(domain.check_ids);
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

                    <p className="audit-readiness__assertion">{domain.assertion_text}</p>

                    {domain.temporal_sentence ? (
                      <p className="audit-readiness__temporal">{domain.temporal_sentence}</p>
                    ) : null}

                    {domain.named_sources && domain.named_sources.length > 0 ? (
                      <p className="audit-readiness__sources">
                        <span className="audit-readiness__sources-label">Sources:</span>{" "}
                        {domain.named_sources.join(" · ")}
                      </p>
                    ) : null}

                    <p className="audit-readiness__coverage">{domain.coverage_line}</p>

                    {domain.scope_note ? (
                      <p className="audit-readiness__scope-note">{domain.scope_note}</p>
                    ) : null}

                    {domain.control_tags.length > 0 ? (
                      <div className="audit-readiness__tags" aria-label="Framework controls">
                        {domain.control_tags.map((tag) => (
                          <span key={tag} className="audit-readiness__tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}

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
