import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { policyGenerationStatusSchema } from "../lib/apiSchemas";
import {
  isPolicyGenInFlightStatus,
  useRecheckNotifications,
} from "../context/RecheckNotificationsContext";
import { cloudTrailJobStartedAt } from "../lib/cloudTrailElapsed";

type PolicyGenStatusRow = {
  status?: string;
  job_id?: string;
  started_on?: string;
  completed_on?: string;
};

function isSucceededStatus(status: string | undefined): boolean {
  return (status ?? "").toUpperCase() === "SUCCEEDED";
}

export function useCloudTrailPolicyGen(args: {
  findingId: string;
  accountId: string;
  roleArn: string;
  accessAnalyzerReason?: string | null;
  jobCompleted?: boolean;
  /** Poll AWS + resume persisted tracking when this role may have an in-flight job. */
  watch: boolean;
  onComplete?: () => void;
}) {
  const { findingId, accountId, roleArn, accessAnalyzerReason, jobCompleted, watch, onComplete } =
    args;
  const { pendingCloudTrail, resumeCloudTrailPolling, notificationHistory } =
    useRecheckNotifications();

  const trackingThisRole =
    pendingCloudTrail?.findingId === findingId && pendingCloudTrail?.roleArn === roleArn;

  const statusQ = useQuery({
    queryKey: ["policy-gen-status", accountId, roleArn],
    queryFn: () =>
      api<PolicyGenStatusRow>(
        `/v1/accounts/${accountId}/roles/policy-generation/status?role_arn=${encodeURIComponent(roleArn)}`,
        { schema: policyGenerationStatusSchema },
      ),
    enabled: Boolean(accountId && roleArn) && (watch || trackingThisRole),
    refetchInterval: (query) => {
      const st = query.state.data?.status;
      if (
        isPolicyGenInFlightStatus(st) ||
        trackingThisRole ||
        accessAnalyzerReason === "in_progress"
      ) {
        return 15_000;
      }
      return false;
    },
    staleTime: 0,
  });

  const statusRunning = isPolicyGenInFlightStatus(statusQ.data?.status);
  const statusSucceeded =
    isSucceededStatus(statusQ.data?.status) || Boolean(jobCompleted && !statusRunning && !isPolicyGenInFlightStatus(statusQ.data?.status));
  const isRunning =
    !statusSucceeded &&
    (trackingThisRole || accessAnalyzerReason === "in_progress" || statusRunning);

  useEffect(() => {
    if (!accountId || !roleArn) return;
    if (trackingThisRole || statusSucceeded) return;
    if (accessAnalyzerReason === "in_progress" || statusRunning) {
      resumeCloudTrailPolling({ findingId, accountId, roleArn });
    }
  }, [
    accountId,
    roleArn,
    trackingThisRole,
    accessAnalyzerReason,
    statusRunning,
    statusSucceeded,
    findingId,
    resumeCloudTrailPolling,
  ]);

  const wasRunning = useRef(false);
  const refreshedOnSuccess = useRef(false);
  useEffect(() => {
    if (isRunning) {
      wasRunning.current = true;
      refreshedOnSuccess.current = false;
      return;
    }
    // Only refetch when a job we were tracking finishes — not on reopen when already SUCCEEDED.
    if (!wasRunning.current) return;
    wasRunning.current = false;
    if (statusSucceeded && !refreshedOnSuccess.current) {
      refreshedOnSuccess.current = true;
      onComplete?.();
    }
  }, [isRunning, statusSucceeded, onComplete]);

  const runningNotice = notificationHistory.find(
    (h) =>
      h.kind === "cloudtrail" &&
      h.findingId === findingId &&
      h.roleArn === roleArn &&
      h.status === "running",
  );

  const startedAt = useMemo(() => {
    if (!isRunning) return undefined;
    return cloudTrailJobStartedAt({
      pendingStartedAt: trackingThisRole ? pendingCloudTrail?.startedAt : undefined,
      historyStartedAt:
        runningNotice && runningNotice.kind === "cloudtrail"
          ? runningNotice.startedAt ?? runningNotice.completedAt
          : undefined,
      awsStartedOn: statusQ.data?.started_on,
    });
  }, [
    isRunning,
    trackingThisRole,
    pendingCloudTrail?.startedAt,
    runningNotice,
    statusQ.data?.started_on,
  ]);

  return {
    isRunning,
    startedAt,
    status: statusQ.data?.status,
    statusSucceeded,
  };
}
