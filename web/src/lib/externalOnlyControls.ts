/** External-only composites have no AWS checks — blocking gaps vs guidance copy. */

export type ExternalOnlyControlCopy = {
  id: string;
  title: string;
  description: string;
  /** Short: what is blocked and why (blocking gaps section only). */
  blockingGapSummary: string;
  /** Long: export steps, auditor expectations, platform examples (guidance section only). */
  guidance: string;
};

export const EXTERNAL_ONLY_CONTROLS: ExternalOnlyControlCopy[] = [
  {
    id: "endpoint_security",
    title: "Endpoint security",
    description: "Requires external endpoint security or EDR evidence.",
    blockingGapSummary:
      "No cloud scan coverage — corporate endpoints are outside AWS.",
    guidance:
      "Export a device or agent coverage report from your EDR platform and upload it below. " +
      "CrowdStrike, SentinelOne, and Microsoft Defender for Endpoint are common sources. " +
      "Auditors typically want agent coverage across the employee fleet, real-time alerting enabled, " +
      "and a recent export dated within your audit period. Declare your platform in Workspace → Evidence " +
      "to streamline future uploads.",
  },
  {
    id: "mdm_endpoint",
    title: "Device management (MDM)",
    description: "Requires external mobile-device management evidence.",
    blockingGapSummary: "No cloud scan coverage — managed devices are outside AWS.",
    guidance:
      "Export a device compliance report from your MDM platform (Intune, Jamf Pro, Kandji, …) showing " +
      "enrollment, disk encryption, and screen-lock enforcement, then upload it below. " +
      "Auditors typically want proof that corporate laptops and mobile devices in scope are enrolled " +
      "and meet baseline policies. If no managed devices are in your audit boundary, mark this control " +
      "out of scope with a rationale instead.",
  },
];

const BY_ID = new Map(EXTERNAL_ONLY_CONTROLS.map((row) => [row.id, row]));

export function externalOnlyControlCopy(compositeId: string): ExternalOnlyControlCopy | null {
  return BY_ID.get(compositeId) ?? null;
}

export function isExternalOnlyComposite(checkIds: string[]): boolean {
  return checkIds.length === 0;
}

export function externalOnlyBlockingGapSummary(compositeId: string): string {
  return (
    BY_ID.get(compositeId)?.blockingGapSummary ??
    "No cloud scan coverage — this control requires external evidence."
  );
}

export function externalOnlyGuidance(
  compositeId: string,
  apiGuidance: string | null,
): string | null {
  return BY_ID.get(compositeId)?.guidance ?? apiGuidance;
}
