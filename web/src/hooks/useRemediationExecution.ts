import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "../api";

export type RemediationExecutionRow = {
  status: string;
  plan_id?: string;
  completed_at?: string;
  error?: string;
  result?: { ok?: boolean; ssm_status?: string };
  automation_execution_id?: string | null;
  ssm_status?: string | null;
  status_sync?: { polled?: boolean; ssm_status?: string | null; error?: string | null; region?: string | null };
};

export function useRemediationExecution(findingId: string) {
  return useQuery({
    queryKey: ["remediation-execution", findingId],
    queryFn: () => api<RemediationExecutionRow>(`/v1/findings/${findingId}/remediation-execution`),
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
