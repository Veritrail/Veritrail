import { absenceGapPrompt } from "../lib/evidenceGap";

export function AbsenceGapSummaryTile({
  regionCount,
  capability,
  checkId,
}: {
  regionCount: number;
  capability: string;
  checkId: string;
}) {
  const prompt = absenceGapPrompt(checkId);
  const regionLabel = regionCount === 1 ? "region" : "regions";

  return (
    <div className="checklist-step-drawer__absence-tile">
      <span
        className="checklist-step-drawer__absence-count"
        aria-label={`${regionCount} ${regionLabel} affected`}
      >
        {regionCount}
      </span>
      <div className="checklist-step-drawer__absence-body">
        <p className="checklist-step-drawer__absence-context">
          <strong>{regionLabel}</strong> require {capability} enabled.
        </p>
        <p className="checklist-step-drawer__absence-alternative">{prompt.awsOption}</p>
      </div>
    </div>
  );
}
