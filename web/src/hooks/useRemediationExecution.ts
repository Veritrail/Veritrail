import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { remediationExecutionSchema, type RemediationExecution } from "../lib/apiSchemas";

export type RemediationExecutionRow = RemediationExecution;

export function useRemediationExecution(findingId: string) {
  return useQuery({
    queryKey: ["remediation-execution", findingId],
    queryFn: () =>
      api(`/v1/findings/${findingId}/remediation-execution`, { schema: remediationExecutionSchema }),
    enabled: !!findingId,
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "dispatched" ? 4_000 : false;
    },
  });
}

export async function refreshRemediationExecution(qc: QueryClient, findingId: string) {
  await qc.invalidateQueries({ queryKey: ["remediation-execution", findingId] });
  await qc.refetchQueries({ queryKey: ["remediation-execution", findingId], type: "active" });
}
