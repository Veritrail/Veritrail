import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { scanRunLatestNullableSchema, type ScanRunLatest } from "../lib/apiSchemas";
import { saveScanDurationMs, useScanProgress, type WorkerProgress } from "./useScanProgress";

export type { ScanRunLatest } from "../lib/apiSchemas";

const STARTING_TIMEOUT_MS = 5 * 60 * 1000;
const pendingScanAtMs = new Map<string, number>();

function pendingCloudScanKey(provider: string, resourceId: string) {
  return `veritrail:cloud-scan-pending:${provider}:${resourceId}`;
}

function pendingMapKey(provider: string, resourceId: string) {
  return `${provider}:${resourceId}`;
}

function readPendingCloudScan(provider: string, resourceId: string): Date | null {
  const key = pendingMapKey(provider, resourceId);
  let ms = pendingScanAtMs.get(key);
  if (ms == null) {
    try {
      const raw = sessionStorage.getItem(pendingCloudScanKey(provider, resourceId));
      if (raw) ms = parseInt(raw, 10);
    } catch {
      /* sessionStorage unavailable */
    }
  }
  if (ms == null || !Number.isFinite(ms) || Date.now() - ms > STARTING_TIMEOUT_MS) {
    clearPendingCloudScan(provider, resourceId);
    return null;
  }
  pendingScanAtMs.set(key, ms);
  return new Date(ms);
}

function writePendingCloudScan(provider: string, resourceId: string, at: Date) {
  const key = pendingMapKey(provider, resourceId);
  pendingScanAtMs.set(key, at.getTime());
  try {
    sessionStorage.setItem(pendingCloudScanKey(provider, resourceId), String(at.getTime()));
  } catch {
    /* sessionStorage unavailable */
  }
}

export function clearPendingCloudScan(provider: string, resourceId: string) {
  const key = pendingMapKey(provider, resourceId);
  pendingScanAtMs.delete(key);
  try {
    sessionStorage.removeItem(pendingCloudScanKey(provider, resourceId));
  } catch {
    /* sessionStorage unavailable */
  }
}

function workerProgressFromRun(run: ScanRunLatest | null | undefined): WorkerProgress | null {
  const step = run?.progress_step;
  const total = run?.progress_total;
  if (step == null || total == null || total <= 0) return null;
  return {
    step,
    total,
    phase: run?.progress_phase ?? null,
    stepName: run?.progress_step_name ?? null,
    collectorIndex: run?.progress_collector_index ?? null,
    collectorTotal: run?.progress_collector_total ?? null,
  };
}

function pendingMatchesRun(pendingAt: Date, run: ScanRunLatest): boolean {
  const pendingMs = pendingAt.getTime();
  if (run.status === "running") {
    return new Date(run.started_at).getTime() >= pendingMs - 2000;
  }
  if (run.status === "ok" || run.status === "error") {
    if (!run.finished_at) return false;
    return new Date(run.finished_at).getTime() >= pendingMs - 2000;
  }
  return false;
}

type UseTriggeredCloudScanOptions = {
  onScanComplete?: () => void;
  backgroundPollMs?: number;
};

export function useTriggeredCloudScan(
  provider: string | undefined,
  resourceId: string | undefined,
  options?: UseTriggeredCloudScanOptions,
) {
  const qc = useQueryClient();
  const [scanTriggered, setScanTriggered] = useState(false);
  const [localScanStartedAt, setLocalScanStartedAt] = useState<Date | null>(null);
  const prevScanStatus = useRef<string | null>(null);
  const completedRunIdRef = useRef<string | null>(null);
  const onScanCompleteRef = useRef(options?.onScanComplete);
  onScanCompleteRef.current = options?.onScanComplete;
  const backgroundPollMs = options?.backgroundPollMs;

  const scanRun = useQuery({
    queryKey: ["cloud-scan-run-latest", provider, resourceId],
    queryFn: () =>
      provider && resourceId
        ? api(`/v1/integrations/cloud-accounts/${provider}/${resourceId}/scan-runs/latest`, {
            schema: scanRunLatestNullableSchema,
          })
        : null,
    enabled: !!provider && !!resourceId,
    refetchOnMount: "always",
    refetchInterval: () => {
      if (!provider || !resourceId) return false;
      const pending = readPendingCloudScan(provider, resourceId);
      const status = qc.getQueryData<ScanRunLatest | null>([
        "cloud-scan-run-latest",
        provider,
        resourceId,
      ])?.status;
      if (pending || status === "running") return 2000;
      return backgroundPollMs ?? false;
    },
  });

  const scanStatus = scanRun.data?.status ?? null;
  const scanStartedAt = scanRun.data?.started_at ? new Date(scanRun.data.started_at) : null;
  const pendingFromStorage =
    provider && resourceId ? readPendingCloudScan(provider, resourceId) : null;
  const pendingAt = localScanStartedAt ?? pendingFromStorage;
  const isRunning =
    scanStatus === "running" &&
    !!scanRun.data &&
    (!pendingAt || pendingMatchesRun(pendingAt, scanRun.data));
  const isQueuePending = (scanTriggered || !!pendingFromStorage) && !isRunning;
  const isScanActive = isQueuePending || isRunning;
  const effectiveScanStartedAt = isRunning
    ? scanStartedAt
    : isQueuePending
      ? pendingAt
      : null;
  const workerProgress = isRunning ? workerProgressFromRun(scanRun.data) : null;
  const scanProgress = useScanProgress(isScanActive, effectiveScanStartedAt, workerProgress);

  useEffect(() => {
    if (!provider || !resourceId) return;
    const pending = readPendingCloudScan(provider, resourceId);
    if (!pending) return;
    setScanTriggered(true);
    setLocalScanStartedAt((cur) => cur ?? pending);
  }, [provider, resourceId]);

  useEffect(() => {
    const run = scanRun.data;
    const pending = pendingAt;

    const completedViaTransition = prevScanStatus.current === "running" && scanStatus === "ok";
    const completedViaPending =
      !!run &&
      !!pending &&
      run.status === "ok" &&
      pendingMatchesRun(pending, run);
    if (
      (completedViaTransition || completedViaPending) &&
      run?.id &&
      completedRunIdRef.current !== run.id
    ) {
      completedRunIdRef.current = run.id;
      onScanCompleteRef.current?.();
      if (run.started_at && run.finished_at) {
        saveScanDurationMs(run.started_at, run.finished_at);
      }
    }

    if (run && pending && provider && resourceId) {
      if (run.status === "running" && pendingMatchesRun(pending, run)) {
        clearPendingCloudScan(provider, resourceId);
        setScanTriggered(false);
      } else if (
        (run.status === "ok" || run.status === "error") &&
        pendingMatchesRun(pending, run)
      ) {
        clearPendingCloudScan(provider, resourceId);
        setScanTriggered(false);
        setLocalScanStartedAt(null);
      }
    } else if ((scanStatus === "ok" || scanStatus === "error") && !pending && !scanTriggered) {
      setLocalScanStartedAt(null);
    }

    prevScanStatus.current = scanStatus;
  }, [provider, resourceId, scanStatus, scanTriggered, pendingAt, scanRun.data]);

  useEffect(() => {
    if (!pendingAt || isRunning || !provider || !resourceId) return;
    const remaining = STARTING_TIMEOUT_MS - (Date.now() - pendingAt.getTime());
    if (remaining <= 0) {
      clearPendingCloudScan(provider, resourceId);
      setScanTriggered(false);
      setLocalScanStartedAt(null);
      return;
    }
    const id = setTimeout(() => {
      clearPendingCloudScan(provider, resourceId);
      setScanTriggered(false);
      setLocalScanStartedAt(null);
    }, remaining);
    return () => clearTimeout(id);
  }, [provider, resourceId, isRunning, pendingAt]);

  const scan = useMutation({
    mutationFn: (path: string) => api(path, { method: "POST", body: "{}" }),
    onSuccess: () => {
      setTimeout(
        () => qc.invalidateQueries({ queryKey: ["cloud-scan-run-latest", provider, resourceId] }),
        300,
      );
    },
    onError: () => {
      if (provider && resourceId) {
        clearPendingCloudScan(provider, resourceId);
        setScanTriggered(false);
        setLocalScanStartedAt(null);
      }
    },
  });

  function triggerScan(scanPath: string) {
    if (!provider || !resourceId) return;
    const at = new Date();
    writePendingCloudScan(provider, resourceId, at);
    setScanTriggered(true);
    setLocalScanStartedAt(at);
    scan.mutate(scanPath);
  }

  return {
    scanRun,
    scanStatus,
    isRunning,
    scanTriggered,
    isScanActive,
    scanProgress,
    triggerScan,
    scan,
  };
}
