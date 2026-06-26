import { useAccountScanRun } from "../hooks/useAccountScanRun";

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function ScanCollectorSummary({ accountId }: { accountId?: string | null }) {
  const { scanRun } = useAccountScanRun(accountId);
  const run = scanRun.data;
  if (!run || run.status === "running") return null;

  const finished = run.finished_at ? new Date(run.finished_at).toLocaleString() : null;
  const duration =
    run.duration_seconds != null
      ? formatDuration(run.duration_seconds)
      : run.finished_at && run.started_at
        ? formatDuration((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)
        : null;

  return (
    <div className="compliance-scan-collector-summary">
      <p className="compliance-group-card-title">Latest collector run</p>
      <dl className="compliance-scan-collector-summary__grid">
        <div>
          <dt>Status</dt>
          <dd>{run.status}</dd>
        </div>
        <div>
          <dt>Finished</dt>
          <dd>{finished ?? "—"}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{duration ?? "—"}</dd>
        </div>
        <div>
          <dt>Checks run</dt>
          <dd>{run.checks_run_count ?? "—"}</dd>
        </div>
        <div>
          <dt>Check errors</dt>
          <dd>{run.check_error_count ?? 0}</dd>
        </div>
        {run.failed_at ? (
          <div className="compliance-scan-collector-summary__wide">
            <dt>Failed phase</dt>
            <dd>
              {run.failed_at}
              {run.error_type ? ` (${run.error_type})` : ""}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
