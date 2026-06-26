import { Link } from "react-router-dom";
import { absenceGapPrompt, openAbsenceGapChecks } from "../lib/evidenceGap";

export function AbsenceGapCallout({
  checkIds,
  findingCountByCheck,
  onAddEvidence,
  remediateHref,
  canEdit = false,
  compact = false,
}: {
  checkIds: string[];
  findingCountByCheck: Map<string, number>;
  onAddEvidence?: () => void;
  remediateHref?: string | null;
  canEdit?: boolean;
  compact?: boolean;
}) {
  const openGaps = openAbsenceGapChecks(checkIds, findingCountByCheck);
  if (openGaps.length === 0) return null;

  return (
    <div className={`compliance-external-evidence__gap-banner${compact ? " compliance-external-evidence__gap-banner--compact" : ""}`}>
      <p className="compliance-external-evidence__gap-title">Two ways to close this gap</p>
      <ul className="compliance-external-evidence__gap-list">
        {openGaps.map((id) => {
          const prompt = absenceGapPrompt(id);
          return (
            <li key={id} className="compliance-external-evidence__gap-item">
              <p className="compliance-external-evidence__gap-headline">{prompt.capability}</p>
              <ol className="compliance-external-evidence__gap-options">
                <li>
                  <span className="compliance-external-evidence__gap-option-label">Upload external evidence.</span>{" "}
                  {prompt.externalOption}
                </li>
                <li>
                  <span className="compliance-external-evidence__gap-option-label">Enable in AWS.</span>{" "}
                  {prompt.awsOption}
                </li>
              </ol>
            </li>
          );
        })}
      </ul>
      <div className="compliance-external-evidence__gap-actions">
        {canEdit && onAddEvidence && (
          <button type="button" className="compliance-external-evidence__gap-action" onClick={onAddEvidence}>
            Add external evidence
          </button>
        )}
        {remediateHref && (
          <Link to={remediateHref} className="compliance-external-evidence__gap-remediate">
            View findings to remediate in AWS →
          </Link>
        )}
      </div>
    </div>
  );
}
