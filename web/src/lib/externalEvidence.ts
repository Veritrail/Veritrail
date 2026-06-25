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
  external_url: string | null;
  owner: string | null;
  status: string;
  expires_at: string | null;
  filename: string | null;
  size_bytes: number;
  note: string | null;
  created_at: string | null;
};

export const VULN_COMPOSITE_IDS = new Set([
  "vulnerability_management",
  "container_vulnerability_monitoring",
]);

export const EXTERNAL_SCANNER_SOURCES = [
  "Wiz",
  "Orca",
  "Snyk",
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
