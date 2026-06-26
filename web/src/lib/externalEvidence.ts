export type ExternalEvidenceArtifact = {
  id: string;
  control_id: string | null;
  composite_control_id: string | null;
  check_id: string | null;
  framework: string;
  control_ref: string | null;
  title: string;
  source: string | null;
  evidence_type: string | null;
  period_start: string | null;
  period_end: string | null;
  external_url: string | null;
  owner: string | null;
  status: string;
  expires_at: string | null;
  filename: string | null;
  size_bytes: number;
  note: string | null;
  created_at: string | null;
  checksum_sha256: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  superseded_by: string | null;
};

export const VULN_COMPOSITE_IDS = new Set([
  "vulnerability_management",
  "container_vulnerability_monitoring",
]);

export const EXTERNAL_SCANNER_SOURCES = [
  "Wiz",
  "Orca",
  "Snyk",
  "Tenable",
  "Qualys",
  "Aikido",
  "GitHub Advanced Security",
  "Trivy",
  "Other",
] as const;

export const EXTERNAL_EVIDENCE_TYPES = [
  "Scanner export",
  "Dashboard screenshot",
  "Policy / attestation",
  "Other",
] as const;

/** Evidence is stale when its coverage period ended or expires_at is in the past. */
export function evidenceIsStale(item: ExternalEvidenceArtifact): boolean {
  if (item.status === "rejected") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const iso of [item.expires_at, item.period_end]) {
    if (!iso) continue;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime()) && d < today) return true;
  }
  return false;
}
