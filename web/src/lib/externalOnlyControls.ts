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

/**
 * Intentionally empty (July 2026 scope decision): Veritrail shows only what it
 * can collect. Endpoint security / EDR and MDM enrollment evidence belong to
 * the customer's GRC platform — surfacing them here meant a permanent
 * "Coverage gap" no scan could ever clear. Backend composite rows are retained
 * so previously uploaded evidence keeps its reference; they are simply no
 * longer displayed. Device *encryption* remains covered via the Intune/Jamf
 * sync checks under Identity Governance.
 */
export const EXTERNAL_ONLY_CONTROLS: ExternalOnlyControlCopy[] = [];

const BY_ID = new Map(EXTERNAL_ONLY_CONTROLS.map((row) => [row.id, row]));

export function externalOnlyControlCopy(compositeId: string): ExternalOnlyControlCopy | null {
  return BY_ID.get(compositeId) ?? null;
}

export function isExternalOnlyComposite(checkIds: string[], compositeId?: string): boolean {
  if (compositeId && EXTERNAL_ONLY_CONTROLS.some((row) => row.id === compositeId)) {
    return true;
  }
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
