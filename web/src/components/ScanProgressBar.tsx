import { formatScanDuration } from "../hooks/useScanProgress";

type ScanProgressBarProps = {
  phase: "starting" | "running";
  progress: number;
  elapsedMs: number;
  remainingMs: number | null;
  finishing: boolean;
  indeterminate: boolean;
  progressStep?: number | null;
  progressTotal?: number | null;
  className?: string;
};

function scanProgressDetail({
  phase,
  elapsedMs,
  remainingMs,
  finishing,
  progressStep,
  progressTotal,
}: Pick<
  ScanProgressBarProps,
  "phase" | "elapsedMs" | "remainingMs" | "finishing" | "progressStep" | "progressTotal"
>) {
  const stepPrefix =
    progressStep != null && progressTotal != null && progressTotal > 0
      ? `Step ${progressStep} of ${progressTotal} · `
      : "";

  if (finishing && progressStep == null) {
    return `${stepPrefix}${formatScanDuration(elapsedMs)} elapsed · finishing up (past estimate)`;
  }
  if (finishing) {
    return `${stepPrefix}${formatScanDuration(elapsedMs)} elapsed · finishing checks`;
  }
  if (phase === "starting") {
    return `${stepPrefix}Queued · waiting for worker`;
  }
  return `${stepPrefix}${formatScanDuration(elapsedMs)} elapsed`;
}

export default function ScanProgressBar({
  phase,
  progress,
  elapsedMs,
  remainingMs,
  finishing,
  indeterminate,
  progressStep,
  progressTotal,
  className,
}: ScanProgressBarProps) {
  const label = phase === "starting" ? "Starting scan" : "Scanning account";
  const detail = scanProgressDetail({
    phase,
    elapsedMs,
    remainingMs,
    finishing,
    progressStep,
    progressTotal,
  });

  return (
    <div className={`overflow-hidden rounded-xl border border-zinc-200 bg-white ${className ?? "mb-4"}`}>
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5 text-sm text-zinc-800">
          <svg className="h-4 w-4 shrink-0 animate-spin text-teal-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <div className="min-w-0">
            <span className="font-semibold">{label}</span>
            <span className="text-zinc-500"> — {detail}</span>
          </div>
        </div>
        {!indeterminate && (
          <span className="shrink-0 text-xs font-semibold tabular-nums text-teal-700">{Math.round(progress)}%</span>
        )}
      </div>
      <div className="h-1 overflow-hidden bg-zinc-100">
        {indeterminate ? (
          <div className="h-full w-1/3 animate-scan-indeterminate rounded-full bg-teal-500" />
        ) : (
          <div
            className="h-full rounded-full bg-teal-600 transition-[width] duration-1000 ease-out"
            style={{ width: `${progress}%` }}
          />
        )}
      </div>
    </div>
  );
}
