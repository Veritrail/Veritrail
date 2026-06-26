import { useEffect, useState } from "react";

const LAST_SCAN_DURATION_KEY = "veritrail:lastScanDurationMs";
/** Fallback when no history and worker has not reported step progress yet. */
const DEFAULT_SCAN_DURATION_MS = 600_000;

export type WorkerProgress = {
  step: number;
  total: number;
  phase?: number | null;
  stepName?: string | null;
  collectorIndex?: number | null;
  collectorTotal?: number | null;
};

/** Must match `_COLLECTOR_STEPS` in `api/app/worker/scan_pipeline.py`. */
export const WORKER_COLLECTOR_STEPS = 32;
export const WORKER_FINALIZE_STEPS = 2;

/**
 * UI phase band starts (0–1). Must stay in sync with `_PHASE_THRESHOLDS` in
 * `api/app/worker/scan_pipeline.py`.
 */
export const UI_PHASE_THRESHOLDS = [0, 0.05, 0.55, 0.7, 0.85, 0.95] as const;

/** Weight collection (~55%) so the bar moves during the slow collector phase. */
export function workerProgressRatio(step: number, total: number): number {
  if (total <= 0 || step <= 0) return 0;
  const collectors = WORKER_COLLECTOR_STEPS;
  const finalize = WORKER_FINALIZE_STEPS;
  const checkTotal = Math.max(0, total - collectors - finalize);
  const collectionEnd = 0.55;
  const checksEnd = 0.95;

  if (step <= collectors) {
    return (step / collectors) * collectionEnd;
  }
  if (step <= collectors + checkTotal) {
    const checkStep = step - collectors;
    return collectionEnd + (checkStep / Math.max(1, checkTotal)) * (checksEnd - collectionEnd);
  }
  const finalizeStep = step - collectors - checkTotal;
  return checksEnd + (finalizeStep / Math.max(1, finalize)) * (1 - checksEnd);
}

/** Map weighted progress ratio onto the 6 Accounts UI phases. */
export function mapProgressRatioToUiPhase(ratio: number): number {
  const r = Math.max(0, Math.min(1, ratio));
  for (let i = UI_PHASE_THRESHOLDS.length - 1; i >= 0; i--) {
    if (r >= UI_PHASE_THRESHOLDS[i]) return i;
  }
  return 0;
}

/** Map fine-grained worker steps onto the 6 marketing phases in the Accounts UI. */
export function mapWorkerStepToUiPhase(step: number, total: number): number {
  if (total <= 0 || step <= 0) return 0;
  if (step <= 1) return 0;
  const ratio = workerProgressRatio(step, total);
  return Math.max(1, mapProgressRatioToUiPhase(ratio));
}

/** Human-readable label for the worker's current step name. */
export function formatProgressStepName(name: string | null | undefined): string | null {
  if (!name) return null;
  if (name === "bootstrap") return "Starting up";
  if (name.startsWith("check:")) {
    return name
      .slice(6)
      .replace(/\./g, " · ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (name === "persist_findings") return "Saving findings";
  if (name === "write_evidence_snapshots") return "Writing evidence";
  const stripped = name.replace(/^collect_/, "").replace(/_/g, " ");
  return stripped.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Title line for Accounts scan module during collection vs other phases. */
export function formatScanProgressDetailLabel(
  activePhaseLabel: string,
  activeIdx: number,
  stepName: string | null | undefined,
  collectorIndex: number | null | undefined,
  collectorTotal: number | null | undefined,
): string {
  const stepLabel = formatProgressStepName(stepName);
  const isCollecting = activeIdx === 1;
  const collectorSuffix =
    isCollecting && collectorIndex != null && collectorTotal != null && collectorTotal > 0
      ? ` (${collectorIndex}/${collectorTotal})`
      : "";

  if (isCollecting && stepLabel) {
    return `${activePhaseLabel}${collectorSuffix} — ${stepLabel}`;
  }
  if (stepLabel && activeIdx <= 1) {
    return `${activePhaseLabel}: ${stepLabel}`;
  }
  return `${activePhaseLabel}${collectorSuffix}`;
}

export function loadExpectedScanDurationMs(): number {
  const raw = localStorage.getItem(LAST_SCAN_DURATION_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 15_000 ? n : DEFAULT_SCAN_DURATION_MS;
}

export function saveScanDurationMs(startedAt: string, finishedAt: string) {
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms >= 15_000) localStorage.setItem(LAST_SCAN_DURATION_KEY, String(ms));
}

export function formatScanDuration(ms: number): string {
  const sec = Math.max(1, Math.ceil(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

type ScanProgress = {
  progress: number;
  elapsedMs: number;
  remainingMs: number | null;
  expectedMs: number;
  indeterminate: boolean;
  finishing: boolean;
  progressStep: number | null;
  progressTotal: number | null;
  progressPhase: number | null;
  progressStepName: string | null;
  progressCollectorIndex: number | null;
  progressCollectorTotal: number | null;
};

export function useScanProgress(
  active: boolean,
  startedAt: Date | null,
  workerProgress?: WorkerProgress | null,
): ScanProgress {
  const [now, setNow] = useState(Date.now());
  const expectedMs = loadExpectedScanDurationMs();

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  const empty: ScanProgress = {
    progress: 0,
    elapsedMs: 0,
    remainingMs: null,
    expectedMs,
    indeterminate: false,
    finishing: false,
    progressStep: null,
    progressTotal: null,
    progressPhase: null,
    progressStepName: null,
    progressCollectorIndex: null,
    progressCollectorTotal: null,
  };

  if (!active) return empty;

  if (!startedAt) {
    return { ...empty, indeterminate: true };
  }

  const elapsedMs = Math.max(0, now - startedAt.getTime());

  if (workerProgress && workerProgress.total > 0) {
    const step = Math.min(workerProgress.step, workerProgress.total);
    const ratio = workerProgressRatio(step, workerProgress.total);
    // Cap below 100% until the run finishes — worker step can hit total while still committing.
    const progress = Math.min(99, Math.max(2, ratio * 100));
    const finishing = ratio >= 0.97;
    return {
      progress,
      elapsedMs,
      remainingMs: null,
      expectedMs,
      indeterminate: false,
      finishing,
      progressStep: step,
      progressTotal: workerProgress.total,
      progressPhase: mapWorkerStepToUiPhase(step, workerProgress.total),
      progressStepName: workerProgress.stepName ?? null,
      progressCollectorIndex: workerProgress.collectorIndex ?? null,
      progressCollectorTotal: workerProgress.collectorTotal ?? null,
    };
  }

  // Worker has not reported step progress yet. Show an indeterminate bar rather than
  // a time-based estimate — the estimate would visibly snap backwards (e.g. 20% -> 4%)
  // the moment real step counts arrive.
  return {
    progress: 0,
    elapsedMs,
    remainingMs: null,
    expectedMs,
    indeterminate: true,
    finishing: false,
    progressStep: null,
    progressTotal: null,
    progressPhase: null,
    progressStepName: null,
    progressCollectorIndex: null,
    progressCollectorTotal: null,
  };
}
