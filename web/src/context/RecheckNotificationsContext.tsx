import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { accountListSchema, cloudAccountListSchema, scanRunLatestNullableSchema } from "../lib/apiSchemas";
import { isAccountConnected } from "../lib/accountConnection";
import { fetchAllFindings } from "../lib/fetchAllFindings";
import { readPendingScan, type ScanRunLatest } from "../hooks/useTriggeredScan";
import { scanFailureAccountLabel } from "../lib/scanFailureMessages";

const STORAGE_KEY = "veritrail.recheckNotifications.v3";
const HISTORY_LIMIT = 100;
/** Max wait after Verify (queued full recheck or stuck pending state). */
export const RECHECK_TIMEOUT_MS = 30_000;
const CLOUDTRAIL_POLL_MS = 30_000;
const CLOUDTRAIL_MAX_MS = 25 * 60 * 1000;
const SCAN_FAILURE_MONITOR_POLL_MS = 5_000;

export type VerifyNotification = {
  id: string;
  kind: "verify";
  findingId: string;
  checkId: string;
  status: "verified" | "unchanged";
  completedAt: number;
  readAt?: number;
};

export type CloudTrailNotification = {
  id: string;
  kind: "cloudtrail";
  findingId: string;
  accountId: string;
  roleArn: string;
  roleLabel: string;
  status: "running" | "succeeded" | "failed";
  /** When local tracking began (ms). */
  startedAt: number;
  completedAt: number;
  readAt?: number;
  message?: string;
};

export type ScanFailureNotification = {
  id: string;
  kind: "scan_failure";
  findingId: string;
  checkId: string;
  status: "failed";
  completedAt: number;
  readAt?: number;
  accountId?: string;
  accountLabel?: string;
  provider?: string;
  message: string;
  failedAt?: string | null;
  errorType?: string | null;
  step?: string | null;
};

export type NotificationItem = VerifyNotification | CloudTrailNotification | ScanFailureNotification;

/** @deprecated Use VerifyNotification — kept for drawer verify flash typing */
export type RecheckOutcome = VerifyNotification;

export type PendingRecheck = {
  findingId: string;
  checkId: string;
  startedAt: number;
};

type PendingCloudTrail = {
  notificationId: string;
  findingId: string;
  accountId: string;
  roleArn: string;
  startedAt: number;
};

/** POST /v1/findings/{id}/recheck — fast path (checked) or async Celery (queued). */
export type RecheckResponse = {
  check_id?: string;
  finding_id?: string;
  queued?: boolean;
  checked?: boolean;
  resolved?: boolean;
  reason?: string;
  error?: string;
};

/** POST /v1/findings/recheck-batch — one AWS refresh pass + one check run for visible rows. */
export type RecheckBatchResponse = {
  check_id?: string | null;
  queued?: boolean;
  checked?: boolean;
  results?: Array<{
    finding_id: string;
    checked?: boolean;
    resolved?: boolean;
  }>;
};

type PersistedV3 = {
  pendingRecheck: PendingRecheck | null;
  pendingCloudTrail: PendingCloudTrail | null;
  history: NotificationItem[];
};

type PersistedV2 = {
  pending: PendingRecheck | null;
  history: Omit<VerifyNotification, "kind">[];
};

type PersistedLegacy = {
  pending: PendingRecheck | null;
  outcome: Omit<VerifyNotification, "id" | "kind"> | null;
};

type PolicyGenStatusRow = { status?: string; job_id?: string };

function newNotificationId(): string {
  return crypto.randomUUID();
}

export function roleLabelFromArn(roleArn: string): string {
  const slash = roleArn.lastIndexOf("/");
  return slash >= 0 ? roleArn.slice(slash + 1) : roleArn;
}

function scanFailureNotificationId({
  accountId,
  message,
  failedAt,
  errorType,
  step,
}: {
  accountId?: string | null;
  message: string;
  failedAt?: string | null;
  errorType?: string | null;
  step?: string | null;
}) {
  return `scan_failure:${accountId ?? "unknown"}:${failedAt ?? "unknown"}:${errorType ?? ""}:${step ?? ""}:${message.slice(0, 120)}`;
}

export function isPolicyGenInFlightStatus(status: string | undefined): boolean {
  const s = (status ?? "").toUpperCase();
  return s === "IN_PROGRESS" || s === "RUNNING" || s === "ACTIVE";
}

function isTerminalPolicyGenStatus(status: string | undefined): boolean {
  const s = (status ?? "").toUpperCase();
  return s === "SUCCEEDED" || s === "FAILED" || s === "CANCELLED" || s === "TIMED_OUT";
}

function migrateLegacyV1(raw: string): PersistedV3 {
  try {
    const parsed = JSON.parse(raw) as PersistedLegacy;
    const history: NotificationItem[] = [];
    if (parsed.outcome) {
      history.push({ ...parsed.outcome, id: newNotificationId(), kind: "verify" });
    }
    return { pendingRecheck: parsed.pending ?? null, pendingCloudTrail: null, history };
  } catch {
    return { pendingRecheck: null, pendingCloudTrail: null, history: [] };
  }
}

function migrateV2(raw: string): PersistedV3 {
  try {
    const parsed = JSON.parse(raw) as PersistedV2;
    const history: NotificationItem[] = (parsed.history ?? []).map((h) => ({
      ...h,
      kind: "verify" as const,
    }));
    return {
      pendingRecheck: parsed.pending ?? null,
      pendingCloudTrail: null,
      history,
    };
  } catch {
    return { pendingRecheck: null, pendingCloudTrail: null, history: [] };
  }
}

function notificationStorageKey(orgId: string | null | undefined): string {
  return orgId ? `${STORAGE_KEY}:${orgId}` : `${STORAGE_KEY}:no-org`;
}

function loadPersisted(storageKey: string): PersistedV3 & { latestVerifyOutcome: VerifyNotification | null } {
  try {
    let state: PersistedV3 = { pendingRecheck: null, pendingCloudTrail: null, history: [] };

    const v3 = localStorage.getItem(storageKey);
    if (v3) {
      const parsed = JSON.parse(v3) as PersistedV3;
      state = {
        pendingRecheck: parsed.pendingRecheck ?? null,
        pendingCloudTrail: parsed.pendingCloudTrail ?? null,
        history: Array.isArray(parsed.history)
          ? parsed.history.map((h) =>
              h.kind === "cloudtrail" && typeof (h as CloudTrailNotification).startedAt !== "number"
                ? { ...h, startedAt: h.completedAt }
                : h,
            )
          : [],
      };
    } else {
      const v2 = localStorage.getItem("veritrail.recheckNotifications.v2");
      if (v2) {
        state = migrateV2(v2);
      } else {
        const v1 = localStorage.getItem("veritrail.recheckNotifications.v1");
        if (v1) state = migrateLegacyV1(v1);
      }
    }

    let latestVerifyOutcome: VerifyNotification | null = null;
    for (const item of state.history) {
      if (item.kind === "verify") {
        latestVerifyOutcome = item;
        break;
      }
    }

    if (state.pendingRecheck && Date.now() - state.pendingRecheck.startedAt >= RECHECK_TIMEOUT_MS) {
      const timedOut: VerifyNotification = {
        id: newNotificationId(),
        kind: "verify",
        findingId: state.pendingRecheck.findingId,
        checkId: state.pendingRecheck.checkId,
        status: "unchanged",
        completedAt: Date.now(),
      };
      state.history = [timedOut, ...state.history].slice(0, HISTORY_LIMIT);
      latestVerifyOutcome = timedOut;
      state.pendingRecheck = null;
    }

    return { ...state, latestVerifyOutcome };
  } catch {
    return { pendingRecheck: null, pendingCloudTrail: null, history: [], latestVerifyOutcome: null };
  }
}

function savePersisted(storageKey: string, state: PersistedV3) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function pushHistory(history: NotificationItem[], entry: NotificationItem): NotificationItem[] {
  return [entry, ...history.filter((h) => h.id !== entry.id)].slice(0, HISTORY_LIMIT);
}

type RecheckNotificationsContextValue = {
  pendingRecheck: PendingRecheck | null;
  pendingCloudTrail: PendingCloudTrail | null;
  recheckOutcome: VerifyNotification | null;
  notificationHistory: NotificationItem[];
  notificationCount: number;
  startRecheck: (findingId: string, checkId: string) => void;
  applyRecheckResult: (findingId: string, checkId: string, result: RecheckResponse) => boolean;
  completeRecheck: (outcome: Omit<VerifyNotification, "completedAt" | "id" | "readAt" | "kind">) => void;
  failRecheck: (findingId: string, checkId: string) => void;
  startCloudTrailAnalysis: (args: {
    findingId: string;
    accountId: string;
    roleArn: string;
    message?: string;
  }) => void;
  resumeCloudTrailPolling: (args: {
    findingId: string;
    accountId: string;
    roleArn: string;
  }) => void;
  failCloudTrailAnalysis: (args: {
    findingId: string;
    accountId: string;
    roleArn: string;
    message: string;
  }) => void;
  reportScanFailure: (args: {
    accountId?: string | null;
    accountLabel?: string | null;
    provider?: string | null;
    message: string;
    failedAt?: string | null;
    errorType?: string | null;
    step?: string | null;
  }) => void;
  clearDrawerVerifyFlash: () => void;
  dismissNotification: (id: string) => void;
  clearAll: () => void;
};

const RecheckNotificationsContext = createContext<RecheckNotificationsContextValue | null>(null);

export function RecheckNotificationsProvider({ children, orgId }: { children: ReactNode; orgId?: string | null }) {
  const qc = useQueryClient();
  const storageKey = useMemo(() => notificationStorageKey(orgId), [orgId]);
  const initial = loadPersisted(storageKey);
  const lastReportedScanFailureRef = useRef<Record<string, string>>({});
  const lastReportedCloudScanFailureRef = useRef<Record<string, string>>({});
  const [pendingRecheck, setPendingRecheck] = useState<PendingRecheck | null>(initial.pendingRecheck);
  const [pendingCloudTrail, setPendingCloudTrail] = useState<PendingCloudTrail | null>(
    initial.pendingCloudTrail,
  );
  const [notificationHistory, setNotificationHistory] = useState<NotificationItem[]>(initial.history);
  const [recheckOutcome, setRecheckOutcome] = useState<VerifyNotification | null>(initial.latestVerifyOutcome);

  useEffect(() => {
    savePersisted(storageKey, { pendingRecheck, pendingCloudTrail, history: notificationHistory });
  }, [pendingRecheck, pendingCloudTrail, notificationHistory, storageKey]);

  const recordVerifyOutcome = useCallback(
    (outcome: Omit<VerifyNotification, "completedAt" | "id" | "readAt" | "kind">) => {
      const entry: VerifyNotification = {
        ...outcome,
        kind: "verify",
        id: newNotificationId(),
        completedAt: Date.now(),
      };
      setNotificationHistory((prev) => pushHistory(prev, entry));
      setRecheckOutcome(entry);
      setPendingRecheck(null);
      return entry;
    },
    [],
  );

  const finishCloudTrail = useCallback(
    (notificationId: string, status: "succeeded" | "failed", message?: string) => {
      setNotificationHistory((prev) =>
        prev.map((item) =>
          item.id === notificationId && item.kind === "cloudtrail"
            ? { ...item, status, completedAt: Date.now(), message: message ?? item.message }
            : item,
        ),
      );
      setPendingCloudTrail(null);
      void qc.invalidateQueries({ queryKey: ["generated-policy"] });
    },
    [qc],
  );

  const startCloudTrailAnalysis = useCallback(
    ({ findingId, accountId, roleArn, message }: {
      findingId: string;
      accountId: string;
      roleArn: string;
      message?: string;
    }) => {
      const id = newNotificationId();
      const now = Date.now();
      const entry: CloudTrailNotification = {
        id,
        kind: "cloudtrail",
        findingId,
        accountId,
        roleArn,
        roleLabel: roleLabelFromArn(roleArn),
        status: "running",
        startedAt: now,
        completedAt: now,
        message,
      };
      setNotificationHistory((prev) => pushHistory(prev, entry));
      setPendingCloudTrail({
        notificationId: id,
        findingId,
        accountId,
        roleArn,
        startedAt: Date.now(),
      });
    },
    [],
  );

  const resumeCloudTrailPolling = useCallback(
    ({ findingId, accountId, roleArn }: {
      findingId: string;
      accountId: string;
      roleArn: string;
    }) => {
      if (
        pendingCloudTrail?.findingId === findingId &&
        pendingCloudTrail?.roleArn === roleArn
      ) {
        return;
      }
      const existing = notificationHistory.find(
        (h): h is CloudTrailNotification =>
          h.kind === "cloudtrail" &&
          h.findingId === findingId &&
          h.roleArn === roleArn &&
          h.status === "running",
      );
      if (existing) {
        setPendingCloudTrail({
          notificationId: existing.id,
          findingId,
          accountId,
          roleArn,
          startedAt: existing.startedAt ?? existing.completedAt,
        });
        return;
      }
      startCloudTrailAnalysis({
        findingId,
        accountId,
        roleArn,
        message: "CloudTrail policy generation is running — checking AWS job status.",
      });
    },
    [notificationHistory, pendingCloudTrail, startCloudTrailAnalysis],
  );

  const failCloudTrailAnalysis = useCallback(
    ({ findingId, accountId, roleArn, message }: {
      findingId: string;
      accountId: string;
      roleArn: string;
      message: string;
    }) => {
      const now = Date.now();
      setNotificationHistory((prev) => {
        const prior = prev.find(
          (h) =>
            h.kind === "cloudtrail" &&
            h.findingId === findingId &&
            h.roleArn === roleArn &&
            h.status === "running",
        );
        const entry: CloudTrailNotification = {
          id: newNotificationId(),
          kind: "cloudtrail",
          findingId,
          accountId,
          roleArn,
          roleLabel: roleLabelFromArn(roleArn),
          status: "failed",
          startedAt:
            prior && prior.kind === "cloudtrail"
              ? prior.startedAt ?? prior.completedAt
              : now,
          completedAt: now,
          message,
        };
        return pushHistory(prev, entry);
      });
      setPendingCloudTrail(null);
    },
    [],
  );

  const reportScanFailure = useCallback(
    ({ accountId, accountLabel, provider, message, failedAt, errorType, step }: {
      accountId?: string | null;
      accountLabel?: string | null;
      provider?: string | null;
      message: string;
      failedAt?: string | null;
      errorType?: string | null;
      step?: string | null;
    }) => {
      const entry: ScanFailureNotification = {
        id: scanFailureNotificationId({ accountId, message, failedAt, errorType, step }),
        kind: "scan_failure",
        findingId: "scan-failure",
        checkId: "scan.error",
        status: "failed",
        completedAt: Date.now(),
        accountId: accountId ?? undefined,
        accountLabel: accountLabel?.trim() || undefined,
        provider: provider?.trim() || undefined,
        message,
        failedAt,
        errorType,
        step,
      };
      setNotificationHistory((prev) => pushHistory(prev, entry));
    },
    [],
  );

  const accountsQ = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api("/v1/accounts", { schema: accountListSchema }),
    enabled: !!orgId,
    staleTime: 30_000,
  });
  const connectedAccounts = useMemo(
    () => accountsQ.data?.filter((account) => isAccountConnected(account)) ?? [],
    [accountsQ.data],
  );
  const monitoredScanRuns = useQueries({
    queries: connectedAccounts.map((account) => ({
      queryKey: ["scan-run-latest", account.id],
      queryFn: () =>
        api(`/v1/accounts/${account.id}/scan-runs/latest`, { schema: scanRunLatestNullableSchema }),
      refetchInterval: (query: { state: { data?: ScanRunLatest | null } }) => {
        if (readPendingScan(account.id) || query.state.data?.status === "running") return 2_000;
        return SCAN_FAILURE_MONITOR_POLL_MS;
      },
      staleTime: 0,
    })),
  });

  useEffect(() => {
    monitoredScanRuns.forEach((scanRun, index) => {
      const account = connectedAccounts[index];
      const run = scanRun.data;
      if (!account || run?.status !== "error" || !run.error) return;
      const failureKey = `${run.id}:${run.failed_at ?? ""}:${run.error_type ?? ""}:${run.error}`;
      if (lastReportedScanFailureRef.current[account.id] === failureKey) return;
      lastReportedScanFailureRef.current[account.id] = failureKey;
      reportScanFailure({
        accountId: account.id,
        accountLabel: scanFailureAccountLabel({
          label: account.label,
          externalId: account.account_id,
        }),
        provider: "aws",
        message: run.error,
        failedAt: run.failed_at ?? null,
        errorType: run.error_type ?? null,
        step: null,
      });
    });
  }, [connectedAccounts, monitoredScanRuns, reportScanFailure]);

  const cloudAccountsQ = useQuery({
    queryKey: ["cloud-accounts"],
    queryFn: () => api("/v1/integrations/cloud-accounts", { schema: cloudAccountListSchema }),
    enabled: !!orgId,
    staleTime: 30_000,
  });
  const connectedCloudAccounts = useMemo(
    () => cloudAccountsQ.data?.filter((account) => account.status === "connected") ?? [],
    [cloudAccountsQ.data],
  );
  const monitoredCloudScanRuns = useQueries({
    queries: connectedCloudAccounts.map((account) => ({
      queryKey: ["cloud-scan-run-latest", account.provider, account.id],
      queryFn: () =>
        api(`/v1/integrations/cloud-accounts/${account.provider}/${account.id}/scan-runs/latest`, {
          schema: scanRunLatestNullableSchema,
        }),
      refetchInterval: (query: { state: { data?: ScanRunLatest | null } }) => {
        if (query.state.data?.status === "running") return 2_000;
        return SCAN_FAILURE_MONITOR_POLL_MS;
      },
      staleTime: 0,
    })),
  });

  useEffect(() => {
    monitoredCloudScanRuns.forEach((scanRun, index) => {
      const account = connectedCloudAccounts[index];
      const run = scanRun.data;
      if (!account || run?.status !== "error" || !run.error) return;
      const monitorKey = `${account.provider}:${account.id}`;
      const failureKey = `${run.id}:${run.failed_at ?? ""}:${run.error_type ?? ""}:${run.error}`;
      if (lastReportedCloudScanFailureRef.current[monitorKey] === failureKey) return;
      lastReportedCloudScanFailureRef.current[monitorKey] = failureKey;
      reportScanFailure({
        accountId: account.id,
        accountLabel: scanFailureAccountLabel({
          label: account.label,
          externalId: account.external_id,
        }),
        provider: account.provider,
        message: run.error,
        failedAt: run.failed_at ?? null,
        errorType: run.error_type ?? null,
        step: null,
      });
    });
  }, [connectedCloudAccounts, monitoredCloudScanRuns, reportScanFailure]);

  const openMetricsQ = useQuery({
    queryKey: ["findings", "open"],
    queryFn: () => fetchAllFindings<{ id: string }>({ status: "open" }),
    refetchInterval: pendingRecheck ? 3000 : false,
    enabled: !!pendingRecheck,
  });

  const startRecheck = useCallback((findingId: string, checkId: string) => {
    setPendingRecheck({ findingId, checkId, startedAt: Date.now() });
    setRecheckOutcome(null);
  }, []);

  const applyRecheckResult = useCallback(
    (findingId: string, checkId: string, result: RecheckResponse): boolean => {
      if (!result.checked) {
        return false;
      }
      recordVerifyOutcome({
        findingId,
        checkId: result.check_id ?? checkId,
        status: result.resolved ? "verified" : "unchanged",
      });
      void qc.invalidateQueries({ queryKey: ["findings"] });
      // A recheck changes findings, which changes compliance pass/fail — refresh the
      // Controls page queries (control list + framework tab percentages) too.
      void qc.invalidateQueries({ queryKey: ["controls"] });
      return true;
    },
    [qc, recordVerifyOutcome],
  );

  const completeRecheck = useCallback(
    (outcome: Omit<VerifyNotification, "completedAt" | "id" | "readAt" | "kind">) => {
      recordVerifyOutcome(outcome);
    },
    [recordVerifyOutcome],
  );

  const failRecheck = useCallback(
    (findingId: string, checkId: string) => {
      recordVerifyOutcome({ findingId, checkId, status: "unchanged" });
    },
    [recordVerifyOutcome],
  );

  const clearDrawerVerifyFlash = useCallback(() => {
    setRecheckOutcome(null);
  }, []);

  const dismissNotification = useCallback((id: string) => {
    const now = Date.now();
    setNotificationHistory((prev) =>
      prev.map((item) => (item.id === id ? { ...item, readAt: item.readAt ?? now } : item)),
    );
    setRecheckOutcome((prev) => (prev?.id === id ? { ...prev, readAt: now } : prev));
  }, []);

  const clearAll = useCallback(() => {
    setPendingRecheck(null);
    setPendingCloudTrail(null);
    setRecheckOutcome(null);
    setNotificationHistory([]);
  }, []);

  useEffect(() => {
    if (!pendingRecheck) return;
    const { findingId, checkId, startedAt } = pendingRecheck;

    const tick = () => {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= RECHECK_TIMEOUT_MS) {
        completeRecheck({ findingId, checkId, status: "unchanged" });
        return;
      }
      const items = openMetricsQ.data?.items;
      if (items && !items.some((f) => f.id === findingId)) {
        completeRecheck({ findingId, checkId, status: "verified" });
        void qc.invalidateQueries({ queryKey: ["findings"] });
        void qc.invalidateQueries({ queryKey: ["controls"] });
      }
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [pendingRecheck, openMetricsQ.data, completeRecheck, qc]);

  useEffect(() => {
    if (!pendingCloudTrail) return;
    const { notificationId, accountId, roleArn, startedAt } = pendingCloudTrail;

    const poll = async () => {
      if (Date.now() - startedAt >= CLOUDTRAIL_MAX_MS) {
        finishCloudTrail(notificationId, "failed", "Timed out waiting for AWS (~25 min).");
        return;
      }
      try {
        const row = await api<PolicyGenStatusRow>(
          `/v1/accounts/${accountId}/roles/policy-generation/status?role_arn=${encodeURIComponent(roleArn)}`,
        );
        const st = (row.status ?? "").toUpperCase();
        if (st === "SUCCEEDED") {
          finishCloudTrail(
            notificationId,
            "succeeded",
            "Analysis complete — rebuild suggestion to apply resource ARNs.",
          );
          return;
        }
        if (isTerminalPolicyGenStatus(row.status)) {
          finishCloudTrail(notificationId, "failed", `Analysis ended (${st}).`);
        }
      } catch {
        /* transient — keep polling */
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), CLOUDTRAIL_POLL_MS);
    return () => window.clearInterval(interval);
  }, [pendingCloudTrail, finishCloudTrail]);

  const notificationCount =
    (pendingRecheck ? 1 : 0) +
    (pendingCloudTrail ? 1 : 0) +
    notificationHistory.filter(
      (h) =>
        !h.readAt &&
        !(
          h.kind === "cloudtrail" &&
          h.status === "running" &&
          pendingCloudTrail?.notificationId === h.id
        ),
    ).length;

  const value = useMemo(
    () => ({
      pendingRecheck,
      pendingCloudTrail,
      recheckOutcome,
      notificationHistory,
      notificationCount,
      startRecheck,
      applyRecheckResult,
      completeRecheck,
      failRecheck,
      startCloudTrailAnalysis,
      resumeCloudTrailPolling,
      failCloudTrailAnalysis,
      reportScanFailure,
      clearDrawerVerifyFlash,
      dismissNotification,
      clearAll,
    }),
    [
      pendingRecheck,
      pendingCloudTrail,
      recheckOutcome,
      notificationHistory,
      notificationCount,
      startRecheck,
      applyRecheckResult,
      completeRecheck,
      failRecheck,
      startCloudTrailAnalysis,
      resumeCloudTrailPolling,
      failCloudTrailAnalysis,
      reportScanFailure,
      clearDrawerVerifyFlash,
      dismissNotification,
      clearAll,
    ],
  );

  return (
    <RecheckNotificationsContext.Provider value={value}>{children}</RecheckNotificationsContext.Provider>
  );
}

export function useRecheckNotifications() {
  const ctx = useContext(RecheckNotificationsContext);
  if (!ctx) {
    throw new Error("useRecheckNotifications must be used within RecheckNotificationsProvider");
  }
  return ctx;
}
