export type CategoryEvidenceCoverageRow = {
  key: string;
  label: string;
  composite_ids: string[];
  primary_composite_id: string | null;
  scan_status: string;
  display_status: string;
  registry_vendor: string | null;
  accepted_artifacts: number;
  submitted_artifacts: number;
  stale_artifacts: number;
};

/** Categories AWS cannot verify (corporate laptops, EDR, MDM). */
export const EXTERNAL_EVIDENCE_ONLY_CATEGORY_KEYS = new Set([
  "endpoint_security",
  "mdm_endpoint",
]);

export type CategoryEvidenceCoverage = {
  framework: string;
  summary: {
    automated_passing: number;
    needs_evidence: number;
    externally_covered: number;
    failing: number;
    at_risk: number;
    unevaluated: number;
    out_of_scope?: number;
    not_applicable?: number;
  };
  categories: CategoryEvidenceCoverageRow[];
  storage_backend: string;
};

const DISPLAY_LABELS: Record<string, string> = {
  passing: "Passing",
  failing: "Failing",
  at_risk: "At risk",
  unevaluated: "Not evaluated",
  externally_covered: "Externally covered",
  needs_evidence: "Coverage gap",
  out_of_scope: "Out of scope",
  not_applicable: "Not applicable",
};

const DISPLAY_TONE: Record<string, string> = {
  passing: "passing",
  failing: "failing",
  at_risk: "at-risk",
  unevaluated: "unevaluated",
  externally_covered: "external",
  needs_evidence: "needs",
  out_of_scope: "out-of-scope",
  not_applicable: "not-applicable",
};

export function coverageDisplayLabel(status: string) {
  return DISPLAY_LABELS[status] ?? status;
}

export function coverageDisplayTone(status: string) {
  return DISPLAY_TONE[status] ?? "unevaluated";
}

export function coverageExternalSummary(cat: CategoryEvidenceCoverageRow) {
  if (cat.accepted_artifacts > 0) {
    const vendor = cat.registry_vendor ? ` (${cat.registry_vendor})` : "";
    return `${cat.accepted_artifacts} accepted${vendor}`;
  }
  if (cat.submitted_artifacts > 0) return `${cat.submitted_artifacts} pending review`;
  if (cat.registry_vendor) return `Declared: ${cat.registry_vendor}`;
  return "None";
}

export function coverageAutomatedSummary(cat: CategoryEvidenceCoverageRow) {
  if (
    EXTERNAL_EVIDENCE_ONLY_CATEGORY_KEYS.has(cat.key) &&
    (cat.display_status === "needs_evidence" || cat.display_status === "unevaluated")
  ) {
    return "Not available from AWS";
  }
  if (cat.display_status === "needs_evidence") {
    return "Not connected";
  }
  if (cat.scan_status === "pass") return "Verified";
  if (cat.scan_status === "no_data") return "Not scanned";
  return "Gap detected";
}
