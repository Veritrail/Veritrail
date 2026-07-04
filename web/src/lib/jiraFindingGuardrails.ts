import type { JiraIssueStatus } from "../hooks/useJiraIssueStatus";

/** Finding is verified/closed in Veritrail after remediation check. */
export function isFindingRemediationVerified(findingStatus: string): boolean {
  return findingStatus === "resolved";
}

/** Jira ticket is Done but Veritrail has not verified the fix yet. */
export function isJiraDoneBeforeVerification(
  jiraStatus: JiraIssueStatus | null | undefined,
  findingStatus: string,
): boolean {
  return Boolean(jiraStatus?.is_done) && !isFindingRemediationVerified(findingStatus);
}

export const JIRA_DONE_UNVERIFIED_WARNING =
  "Run Verify fix in Veritrail before treating as closed.";

export const JIRA_DONE_UNVERIFIED_SHORT = "Done — verify pending";
