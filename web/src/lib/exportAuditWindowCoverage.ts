/**
 * Count how many of the last N calendar months are covered by evidence-pack
 * export windows (as_of − period_days … as_of, falling back to created_at).
 */
export type ExportCoverageRow = {
  created_at: string;
  as_of: string | null;
  period_days: number;
};

export type ExportAuditWindowCoverage = {
  coveredMonths: number;
  totalMonths: number;
  label: string;
};

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function exportWindow(row: ExportCoverageRow): { start: Date; end: Date } | null {
  const endRaw = row.as_of ?? row.created_at;
  const end = new Date(endRaw);
  if (Number.isNaN(end.getTime())) return null;
  const days = Math.max(1, row.period_days || 90);
  const start = new Date(end.getTime() - days * 86_400_000);
  return { start, end };
}

export function exportAuditWindowCoverage(
  exports: ExportCoverageRow[],
  totalMonths = 12,
  now = new Date(),
): ExportAuditWindowCoverage {
  const covered = new Set<string>();
  const windows = exports.map(exportWindow).filter((w): w is { start: Date; end: Date } => w != null);

  for (let i = 0; i < totalMonths; i++) {
    const monthStart = startOfUtcMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const key = monthKey(monthStart);
    for (const w of windows) {
      if (w.start <= monthEnd && w.end >= monthStart) {
        covered.add(key);
        break;
      }
    }
  }

  const coveredMonths = covered.size;
  return {
    coveredMonths,
    totalMonths,
    label: `Exports covering the audit window: ${coveredMonths} of ${totalMonths} months`,
  };
}
