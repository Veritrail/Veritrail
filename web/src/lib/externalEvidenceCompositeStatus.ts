import type { ComplianceDisplayStatus } from "./compositeRecommendedAction";

/** Composite controls AWS cannot verify without uploaded external evidence. */
export const EXTERNAL_EVIDENCE_COMPOSITE_IDS = new Set([
  "endpoint_security",
  "mdm_endpoint",
  "hr_training",
  "vendor_risk",
]);

export function isExternalEvidenceComposite(compositeId: string): boolean {
  return EXTERNAL_EVIDENCE_COMPOSITE_IDS.has(compositeId);
}

/** Mirrors api/app/services/category_evidence_coverage._external_evidence_category_status */
export function externalEvidenceCompositeDisplayStatus(
  compositeId: string,
  baseStatus: ComplianceDisplayStatus,
  hasAccepted: boolean,
  registryVendor?: string | null,
): ComplianceDisplayStatus {
  if (!isExternalEvidenceComposite(compositeId)) return baseStatus;
  if (baseStatus === "out_of_scope" || baseStatus === "not_applicable") {
    return baseStatus;
  }
  if (compositeId === "mdm_endpoint") {
    if (hasAccepted && registryVendor) return "externally_covered";
    return "needs_evidence";
  }
  if (hasAccepted) return "externally_covered";
  if (
    baseStatus === "passing" ||
    baseStatus === "unevaluated" ||
    baseStatus === "failing" ||
    baseStatus === "at_risk"
  ) {
    return "needs_evidence";
  }
  return baseStatus;
}
