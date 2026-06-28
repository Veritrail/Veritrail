import { useMemo } from "react";
import { evidenceArtifactsForControl } from "../lib/controlEvidence";
import type { ExternalEvidenceArtifact } from "../lib/externalEvidence";
import { openAbsenceGapChecks } from "../lib/evidenceGap";
import type { ComplianceDisplayStatus } from "../lib/compositeRecommendedAction";

type ControlSlice = {
  id: string;
  control_id: string;
  check_ids: string[];
  status: "pass" | "fail" | "at_risk" | "no_data";
};

/** Compact row affordance — opens the slide-over drawer. */
export function ControlEvidenceDrawerTrigger({
  control,
  artifacts,
  findingCountByCheck,
  displayStatus,
  submittedCount = 0,
  onOpen,
}: {
  control: ControlSlice;
  artifacts: ExternalEvidenceArtifact[];
  findingCountByCheck: Map<string, number>;
  displayStatus: ComplianceDisplayStatus;
  submittedCount?: number;
  onOpen: () => void;
}) {
  const linked = useMemo(() => evidenceArtifactsForControl(artifacts, control), [artifacts, control]);
  const openGaps = openAbsenceGapChecks(control.check_ids, findingCountByCheck);
  const needsAttention =
    openGaps.length > 0 ||
    linked.some((row) => row.status === "submitted") ||
    linked.some((row) => row.status === "accepted" && control.status === "fail");

  return (
    <button type="button" className="control-evidence-trigger" onClick={onOpen}>
      <span className="control-evidence-trigger__label">Evidence &amp; coverage</span>
      <span className="control-evidence-trigger__meta">
        {linked.length > 0 && <span>{linked.length} external</span>}
        {submittedCount > 0 && <span>{submittedCount} pending review</span>}
        {openGaps.length > 0 && <span>{openGaps.length} gap{openGaps.length === 1 ? "" : "s"}</span>}
        {linked.length === 0 && submittedCount === 0 && openGaps.length === 0 && (
          <span>{displayStatus === "passing" ? "Automated only" : "View details"}</span>
        )}
      </span>
      {needsAttention && <span className="control-evidence-trigger__dot" aria-hidden />}
    </button>
  );
}
