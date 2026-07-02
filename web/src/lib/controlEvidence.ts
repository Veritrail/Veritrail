import type { ExternalEvidenceArtifact } from "./externalEvidence";

function dedupeArtifacts(artifacts: ExternalEvidenceArtifact[]) {
  const seen = new Set<string>();
  return artifacts.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

export function evidenceArtifactsForControl(
  artifacts: ExternalEvidenceArtifact[],
  control: { id: string; control_id: string },
) {
  return dedupeArtifacts(
    artifacts.filter(
      (row) => row.control_id === control.id || row.control_ref === control.control_id,
    ),
  );
}

export function evidenceArtifactsForComposite(
  artifacts: ExternalEvidenceArtifact[],
  compositeId: string,
) {
  return dedupeArtifacts(artifacts.filter((row) => row.composite_control_id === compositeId));
}
