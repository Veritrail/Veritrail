import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api";
import { jiraIntegrationSchema } from "../lib/apiSchemas";

export const JIRA_INTEGRATION_QUERY_KEY = ["jira-integration"] as const;
export const JIRA_INTEGRATION_STALE_MS = 5 * 60_000;

export function jiraIntegrationQueryOptions() {
  return {
    queryKey: JIRA_INTEGRATION_QUERY_KEY,
    queryFn: () => api("/v1/integrations/jira", { schema: jiraIntegrationSchema }),
    staleTime: JIRA_INTEGRATION_STALE_MS,
  } as const;
}

/** Start the integration fetch without subscribing (Findings page mount). */
export function prefetchJiraIntegration(qc: QueryClient) {
  return qc.prefetchQuery(jiraIntegrationQueryOptions());
}

/** Cached Jira connection status — warm with prefetchJiraIntegration on Findings mount. */
export function useJiraIntegration(options?: { enabled?: boolean }) {
  const qc = useQueryClient();
  return useQuery({
    ...jiraIntegrationQueryOptions(),
    initialData: () => qc.getQueryData(JIRA_INTEGRATION_QUERY_KEY),
    enabled: options?.enabled ?? true,
  });
}
