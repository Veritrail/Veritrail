import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import {
  coverageAutomatedSummary,
  coverageDisplayLabel,
  coverageDisplayTone,
  coverageExternalSummary,
  type CategoryEvidenceCoverage,
} from "../lib/categoryEvidenceCoverage";

export function EvidenceCoverageDashboard({
  framework,
  accountId,
  onCategorySelect,
}: {
  framework: string;
  accountId?: string | null;
  onCategorySelect?: (compositeId: string | null, displayStatus: string) => void;
}) {
  const coverageQ = useQuery({
    queryKey: ["evidence-coverage", framework, accountId],
    queryFn: () => {
      const params = new URLSearchParams({ framework });
      if (accountId) params.set("account_id", accountId);
      return api<CategoryEvidenceCoverage>(`/v1/controls/evidence-coverage?${params.toString()}`);
    },
    enabled: !!accountId,
  });

  if (!accountId) return null;
  if (coverageQ.isLoading) {
    return (
      <div className="evidence-coverage-dashboard evidence-coverage-dashboard--loading">
        <p>Loading evidence coverage…</p>
      </div>
    );
  }
  if (!coverageQ.data) return null;

  const { summary, categories, storage_backend } = coverageQ.data;

  return (
    <section className="evidence-coverage-dashboard" aria-label="Evidence coverage by category">
      <div className="evidence-coverage-dashboard__header">
        <div>
          <h2 className="evidence-coverage-dashboard__title">Evidence coverage</h2>
          <p className="evidence-coverage-dashboard__subtitle">
            Automated AWS checks vs external proof — by compliance category
          </p>
        </div>
        <div className="evidence-coverage-dashboard__summary">
          <span className="evidence-coverage-dashboard__pill evidence-coverage-dashboard__pill--passing">
            {summary.automated_passing} passing
          </span>
          <span className="evidence-coverage-dashboard__pill evidence-coverage-dashboard__pill--needs">
            {summary.needs_evidence} need evidence
          </span>
          <span className="evidence-coverage-dashboard__pill evidence-coverage-dashboard__pill--external">
            {summary.externally_covered} external
          </span>
          {(summary.failing > 0 || summary.at_risk > 0) && (
            <span className="evidence-coverage-dashboard__pill evidence-coverage-dashboard__pill--failing">
              {summary.failing + summary.at_risk} gaps
            </span>
          )}
        </div>
      </div>

      <div className="evidence-coverage-dashboard__table-wrap">
        <table className="evidence-coverage-dashboard__table">
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Automated</th>
              <th scope="col">External</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => (
              <tr
                key={cat.key}
                className={onCategorySelect ? "evidence-coverage-dashboard__row--clickable" : undefined}
                onClick={
                  onCategorySelect
                    ? () => onCategorySelect(cat.primary_composite_id, cat.display_status)
                    : undefined
                }
                onKeyDown={
                  onCategorySelect
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onCategorySelect(cat.primary_composite_id, cat.display_status);
                        }
                      }
                    : undefined
                }
                tabIndex={onCategorySelect ? 0 : undefined}
                role={onCategorySelect ? "button" : undefined}
              >
                <td className="evidence-coverage-dashboard__category">{cat.label}</td>
                <td>{coverageAutomatedSummary(cat)}</td>
                <td>
                  {coverageExternalSummary(cat)}
                  {cat.stale_artifacts > 0 ? (
                    <span className="evidence-coverage-dashboard__stale"> · {cat.stale_artifacts} stale</span>
                  ) : null}
                </td>
                <td>
                  <span
                    className={`evidence-coverage-dashboard__status evidence-coverage-dashboard__status--${coverageDisplayTone(cat.display_status)}`}
                  >
                    {coverageDisplayLabel(cat.display_status)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="evidence-coverage-dashboard__footnote">
        Uploaded files stored on <strong>{storage_backend}</strong> backend. Included in audit package as{" "}
        <code>category_evidence_coverage.json</code>.
      </p>
    </section>
  );
}
