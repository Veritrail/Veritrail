export type ComplianceDisplayStatus =
  | "passing"
  | "failing"
  | "at_risk"
  | "unevaluated"
  | "externally_covered"
  | "needs_evidence"
  | "expired"
  | "out_of_scope"
  | "not_applicable";

export type RecommendedAction = {
  title: string;
  detail: string;
  tone: "ok" | "info" | "warn";
};

export function compositeRecommendedAction(
  displayStatus: ComplianceDisplayStatus,
  opts?: { submittedCount?: number; hasPermissionGaps?: boolean },
): RecommendedAction | null {
  if (opts?.hasPermissionGaps) {
    return {
      title: "Fix collector permissions",
      detail:
        "One or more automated checks could not run due to missing IAM permissions. Update your Veritrail connector role, then re-scan.",
      tone: "warn",
    };
  }
  switch (displayStatus) {
    case "needs_evidence":
      return {
        title: "Two ways to close this gap",
        detail:
          "Upload external evidence that you cover this outside AWS, or enable the corresponding AWS capability in this account.",
        tone: "warn",
      };
    case "externally_covered":
      return {
        title: "Externally covered",
        detail:
          "Accepted external evidence is on file. Re-upload when your audit period ends or your scanner export is refreshed.",
        tone: "ok",
      };
    case "expired":
      return {
        title: "Evidence expired",
        detail: "Previously accepted external evidence has expired. Upload refreshed proof for this audit period.",
        tone: "warn",
      };
    case "out_of_scope":
      return {
        title: "Marked out of scope",
        detail: "This requirement is documented as outside your audit scope. Keep the rationale in your audit workbook.",
        tone: "info",
      };
    case "not_applicable":
      return {
        title: "Not applicable",
        detail: "This requirement is marked not applicable for your environment.",
        tone: "info",
      };
    case "failing":
      return {
        title: "Remediate open findings",
        detail: "Open findings are mapped to this group. Fix the underlying issues or document an approved exception.",
        tone: "warn",
      };
    case "at_risk":
      return {
        title: "Review extended checks",
        detail: "Core checks pass, but extended supporting checks have open findings worth reviewing before audit.",
        tone: "info",
      };
    case "unevaluated":
      return {
        title: "Run a scan",
        detail: "No scan data yet for mapped checks. Connect AWS and wait for the first successful scan.",
        tone: "info",
      };
    case "passing":
      if ((opts?.submittedCount ?? 0) > 0) {
        return {
          title: "Review submitted evidence",
          detail: "Automated checks pass, but external evidence is pending admin review.",
          tone: "info",
        };
      }
      return null;
    default:
      return null;
  }
}

export function isPermissionGapError(errorType: string | null | undefined, error: string | null | undefined) {
  const hay = `${errorType ?? ""} ${error ?? ""}`.toLowerCase();
  return (
    hay.includes("accessdenied") ||
    hay.includes("access denied") ||
    hay.includes("not authorized") ||
    hay.includes("unauthorized") ||
    hay.includes("permission")
  );
}
