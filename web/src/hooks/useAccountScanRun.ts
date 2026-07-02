import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { scanRunLatestNullableSchema } from "../lib/apiSchemas";

export type ScanRun = {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  failed_at?: string | null;
  error_type?: string | null;
  findings_opened?: number;
  findings_resolved?: number;
  progress_step?: number | null;
  progress_total?: number | null;
  progress_phase?: number | null;
  duration_seconds?: number | null;
  checks_run_count?: number | null;
  check_error_count?: number | null;
};

export function useAccountScanRun(accountId: string | null | undefined) {
  const scanRun = useQuery({
    queryKey: ["scan-run-latest", accountId],
    queryFn: () =>
      accountId
        ? api(`/v1/accounts/${accountId}/scan-runs/latest`, { schema: scanRunLatestNullableSchema })
        : null,
    enabled: !!accountId,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 3000 : false),
  });

  const scanStatus = scanRun.data?.status ?? null;
  const isRunning = scanStatus === "running";

  return { scanRun, scanStatus, isRunning };
}
