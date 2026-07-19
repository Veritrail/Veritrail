/** What evidence a manual criterion actually needs, and which integration can
 *  cover it instead. "Attach evidence" alone tells the user nothing. */

export type ManualEvidenceHint = {
  /** Concrete artifacts an auditor accepts for this criterion. */
  expected: string;
  /** The primary way this requirement should be collected in the checklist. */
  collectionMode: "connect" | "upload";
  /** Optional integration that can produce this evidence automatically. */
  integration?: { label: string; href: string };
};

const SOC2_HINTS: Record<string, ManualEvidenceHint> = {
  "CC6.4": {
    collectionMode: "upload",
    expected:
      "AWS SOC 2 inheritance excerpt (data-center physical controls) plus your office access policy, if any.",
  },
  "CC6.5": {
    collectionMode: "upload",
    expected:
      "Media disposal policy. AWS destroys physical media — attach the inheritance excerpt for cloud scope.",
  },
  "CC7.3": {
    collectionMode: "connect",
    expected:
      "Incident triage runbook or a recent postmortem showing events were evaluated.",
    integration: { label: "Connect Jira to evidence triage tickets", href: "/integrations/jira" },
  },
  "CC7.4": {
    collectionMode: "upload",
    expected:
      "Incident-response runbook plus a tabletop or drill record (notes, photos, ticket trail).",
    integration: { label: "Connect Jira to evidence incident tickets", href: "/integrations/jira" },
  },
  "CC7.5": {
    collectionMode: "upload",
    expected:
      "Recovery/restore procedure and a record of the last restore test.",
  },
  "A1.1": {
    collectionMode: "upload",
    expected:
      "Capacity review notes or an autoscaling policy summary for in-scope services.",
  },
  "A1.3": {
    collectionMode: "upload",
    expected:
      "Disaster-recovery test report — date, scope, restore result, and follow-ups.",
  },
};

export function manualEvidenceHint(
  framework: string,
  controlId: string,
): ManualEvidenceHint | null {
  if (framework !== "soc2") return null;
  return SOC2_HINTS[controlId] ?? null;
}
