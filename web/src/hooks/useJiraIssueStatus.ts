import { useQuery } from "@tanstack/react-query";

import { api } from "../api";

export type JiraIssueStatus = {
  issue_key: string;
  status: string;
  status_category: string;
  is_done: boolean;
  synced_at: string;
};

const JIRA_STATUS_STALE_MS = 30_000;
const JIRA_STATUS_POLL_MS = 60_000;

/** Fetch and persist Jira status for a finding's linked issue (polls while enabled). */
export function useJiraIssueStatus(
  findingId: string | null | undefined,
  issueKey: string | null | undefined,
  options?: { enabled?: boolean; poll?: boolean },
) {
  const enabled = (options?.enabled ?? true) && !!findingId && !!issueKey;
  return useQuery({
    queryKey: ["jira-issue-status", findingId],
    queryFn: () =>
      api<JiraIssueStatus>(`/v1/integrations/jira/issues/sync-from-finding/${findingId}`, {
        method: "POST",
      }),
    enabled,
    staleTime: JIRA_STATUS_STALE_MS,
    refetchInterval: options?.poll ? JIRA_STATUS_POLL_MS : false,
  });
}
