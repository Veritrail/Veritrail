import type { PeriodSummary } from "../lib/complianceHistory";

export function HistoryPeriodSummary({ summary }: { summary: PeriodSummary | undefined }) {
  if (!summary) return null;

  const snapshots = summary.evidence_snapshots ?? 0;
  const changes = summary.compliance_changes ?? 0;
  if (snapshots === 0 && changes === 0) return null;

  return (
    <p className="text-sm text-zinc-600">
      {snapshots > 0 && (
        <>
          <span className="font-semibold tabular-nums text-zinc-900">{snapshots}</span> evidence
          snapshot{snapshots === 1 ? "" : "s"}
        </>
      )}
      {changes > 0 && (
        <>
          {snapshots > 0 ? " · " : ""}
          <span className="font-semibold tabular-nums text-zinc-900">{changes}</span> posture change
          {changes === 1 ? "" : "s"}
        </>
      )}
      {summary.controls_regressed > 0 && (
        <>
          {" · "}
          <span className="font-medium text-red-700">{summary.controls_regressed} regressed</span>
        </>
      )}
      {summary.controls_improved > 0 && (
        <>
          {" · "}
          <span className="font-medium text-emerald-700">{summary.controls_improved} improved</span>
        </>
      )}
    </p>
  );
}
