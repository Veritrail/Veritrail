import { useEffect, useState } from "react";

const LAST_SCAN_DURATION_KEY = "veritrail:lastScanDurationMs";
/** Fallback when no history and worker has not reported step progress yet. */
const DEFAULT_SCAN_DURATION_MS = 600_000;

export type WorkerProgress = { step: number; total: number; phase?: number | null };

/** Must match collector `_step()` count in `api/app/worker/tasks.py` run_scan. */
export const WORKER_COLLECTOR_STEPS = 26;
export const WORKER_FINALIZE_STEPS = 2;

/** Map fine-grained worker steps onto the 6 marketing phases in the Accounts UI. */
export function mapWorkerStepToUiPhase(step: number, total: number): number {
  const UI_PHASE_COUNT = 6;
  if (total <= 0 || step <= 0) return 0;
  // Derive the phase from the same step/total fraction the % bar uses, so the lit
  // phase always tracks how full the bar is (scales to any worker step count).
  const ratio = Math.min(1, step / total);
  return Math.min(UI_PHASE_COUNT - 1, Math.floor(ratio * UI_PHASE_COUNT));
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
  };

  if (!active) return empty;

  if (!startedAt) {
    return { ...empty, indeterminate: true };
  }

  const elapsedMs = Math.max(0, now - startedAt.getTime());

  if (workerProgress && workerProgress.total > 0) {
    const step = Math.min(workerProgress.step, workerProgress.total);
    const ratio = step / workerProgress.total;
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
      progressPhase: workerProgress.phase ?? null,
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
  };
}
