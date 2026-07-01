export function SeverityIndicator({ severity }: { severity: string }) {
  const badgeClass =
    "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium";
  if (severity === "critical") {
    return (
      <span className={`${badgeClass} bg-red-50 text-red-800 ring-1 ring-red-300/70`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" aria-hidden />
        Critical
      </span>
    );
  }
  if (severity === "high") {
    return (
      <span className={`${badgeClass} bg-red-50/85 text-red-700 ring-1 ring-red-200/65`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500/80" aria-hidden />
        High
      </span>
    );
  }
  if (severity === "medium") {
    return (
      <span className={`${badgeClass} bg-amber-50/90 text-amber-800 ring-1 ring-amber-200/70`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/85" aria-hidden />
        Medium
      </span>
    );
  }
  return (
    <span className={`${badgeClass} bg-zinc-100/90 text-zinc-500 ring-1 ring-zinc-200/70`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400/70" aria-hidden />
      Low
    </span>
  );
}
