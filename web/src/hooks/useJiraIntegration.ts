import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api";
import { jiraIntegrationSchema } from "../lib/apiSchemas";

export const JIRA_INTEGRATION_QUERY_KEY = ["jira-integration"] as const;
export const JIRA_INTEGRATION_STALE_MS = 5 * 60_000;

/** Cached Jira connection status — warm with prefetchQuery on Findings mount. */
export function useJiraIntegration(options?: { enabled?: boolean }) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: JIRA_INTEGRATION_QUERY_KEY,
    queryFn: () => api("/v1/integrations/jira", { schema: jiraIntegrationSchema }),
    staleTime: JIRA_INTEGRATION_STALE_MS,
    initialData: () => qc.getQueryData(JIRA_INTEGRATION_QUERY_KEY),
    enabled: options?.enabled ?? true,
  });
}
