import type { ExternalEvidenceArtifact } from "./externalEvidence";

export function evidenceArtifactsForControl(
  artifacts: ExternalEvidenceArtifact[],
  control: { id: string; control_id: string },
) {
  return artifacts.filter(
    (row) => row.control_id === control.id || row.control_ref === control.control_id,
  );
}
