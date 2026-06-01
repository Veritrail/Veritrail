import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  api,
  formatApiError,
} from "../api";
import {
  FlowBadge,
  FlowCallout,
} from "./FindingDrawerSemantic";

/* ---------- types ---------- */

export interface TriageResultPayload {
  id: string;
  finding_id: string;
  confidence_score: number;
  rationale: string;
  suggested_action: string; // snooze | resolve | review | ignore
  model_version: string;
  created_at: string;
}

interface TriageTriggerResponse {
  queued: boolean;
  ai_triage_enabled: boolean;
  result?: { task_id?: string } | null;
}

/* ---------- helpers ---------- */

function confidenceColor(score: number) {
  if (score > 0.8) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (score >= 0.5) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-red-700 bg-red-50 border-red-200";
}

function confidenceLabel(score: number) {
  if (score > 0.8) return "High confidence";
  if (score >= 0.5) return "Moderate confidence";
  return "Low confidence";
}

function actionBadge(action: string): { label: string; variant: "high" | "caution" | "muted" } {
  switch (action) {
    case "resolve":
      return { label: "Resolve", variant: "high" };
    case "review":
      return { label: "Review", variant: "caution" };
    case "snooze":
      return { label: "Snooze", variant: "muted" };
    case "ignore":
      return { label: "Ignore", variant: "muted" };
    default:
      return { label: action, variant: "muted" };
  }
}

/* ---------- sub-components ---------- */

function TriageSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="h-5 w-28 rounded bg-zinc-100" />
        <div className="h-5 w-16 rounded bg-zinc-100" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full rounded bg-zinc-100" />
        <div className="h-3 w-4/5 rounded bg-zinc-100" />
        <div className="h-3 w-3/4 rounded bg-zinc-100" />
      </div>
    </div>
  );
}

function TriageError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-red-100 bg-red-50/40 px-3 py-2.5 text-xs text-red-700">
      <div className="flex items-start justify-between gap-2">
        <span>Failed to load AI analysis: {message}</span>
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 text-red-600 underline hover:text-red-800"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

/* ---------- main component ---------- */

export function AiTriageSection({
  findingId,
  expanded,
  onToggle,
  onApplyAction,
}: {
  findingId: string;
  expanded: boolean;
  onToggle: () => void;
  onApplyAction?: (action: string) => void;
}) {
  const [viewState, setViewState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const {
    data: triageEnabled,
    isLoading: checkingEnabled,
  } = useQuery({
    queryKey: ["ai-triage-status"],
    queryFn: async () => {
      try {
        // We check by fetching triage for a dummy finding; if disabled
        // the endpoint returns { ai_triage_enabled: false }.
        const resp = await api<{ ai_triage_enabled: boolean; result?: TriageResultPayload | null }>(
          `/v1/findings/${findingId}/triage`
        );
        return resp.ai_triage_enabled !== false;
      } catch {
        return false;
      }
    },
    staleTime: 600_000, // 10 min
    retry: 1,
  });

  const {
    data: triageResult,
    isLoading: loadingResult,
    refetch: refetchTriage,
  } = useQuery({
    queryKey: ["ai-triage", findingId],
    queryFn: async () => {
      const resp = await api<{ ai_triage_enabled: boolean; result?: TriageResultPayload | null }>(
        `/v1/findings/${findingId}/triage`
      );
      if (!resp.ai_triage_enabled) return null;
      return resp.result ?? null;
    },
    enabled: !!triageEnabled && !!findingId,
    staleTime: 120_000,
    retry: 1,
  });

  const triggerTriage = useMutation({
    mutationFn: async () => {
      const resp = await api<TriageTriggerResponse>(
        `/v1/findings/${findingId}/triage`,
        { method: "POST" }
      );
      return resp;
    },
    onMutate: () => {
      setViewState("loading");
    },
    onSuccess: () => {
      // Poll for result — refetch after a short delay
      setTimeout(() => {
        refetchTriage().then(() => {
          setViewState("done");
        }).catch(() => {
          setErrorMsg("Failed to retrieve analysis");
          setViewState("error");
        });
      }, 3000);
    },
    onError: (err: Error) => {
      setErrorMsg(formatApiError(err) || err.message);
      setViewState("error");
    },
  });

  const handleRetry = () => {
    setViewState("loading");
    triggerTriage.mutate();
  };

  // If AI triage is disabled, don't render anything
  if (!checkingEnabled && !triageEnabled) return null;

  // If checking enabled status and it's disabled, hide
  if (triageEnabled === false) return null;

  const result = triageResult;

  // Track pending async operations
  const busy = loadingResult || triggerTriage.isPending || viewState === "loading" || checkingEnabled;

  return (
    <div className="border-b border-zinc-100 px-4 py-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 text-left"
        >
          <svg
            className={`h-4 w-4 text-violet-400 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-sm font-semibold text-zinc-900">AI Analysis</span>
          {result && !busy && (
            <span
              className={`inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-medium ${confidenceColor(result.confidence_score)}`}
            >
              {confidenceLabel(result.confidence_score)}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => { setViewState("loading"); triggerTriage.mutate(); }}
          disabled={busy}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-violet-600 transition hover:bg-violet-50 disabled:opacity-50"
        >
          {busy ? (
            <span className="inline-flex items-center gap-1">
              <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Analysing…
            </span>
          ) : (
            "Re-analyze"
          )}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3">
          {busy && !result && (
            <TriageSkeleton />
          )}

          {viewState === "error" && !result && (
            <TriageError message={errorMsg} onRetry={handleRetry} />
          )}

          {result && (
            <div className="space-y-3">
              {/* Score bar */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-zinc-500">True-positive confidence:</span>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${confidenceColor(result.confidence_score)}`}
                >
                  {(result.confidence_score * 100).toFixed(0)}% — {confidenceLabel(result.confidence_score)}
                </span>
              </div>

              {/* Rationale */}
              <div className="rounded-lg border border-violet-100 bg-violet-50/30 px-3 py-2.5">
                <p className="text-xs leading-relaxed text-zinc-700">{result.rationale}</p>
              </div>

              {/* Suggested action */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-zinc-500">Suggested:</span>
                  <FlowBadge variant={actionBadge(result.suggested_action).variant}>
                    {actionBadge(result.suggested_action).label}
                  </FlowBadge>
                </div>
                {onApplyAction && (
                  <button
                    type="button"
                    onClick={() => onApplyAction(result.suggested_action)}
                    className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700 transition hover:bg-violet-100 active:scale-95"
                  >
                    Apply
                  </button>
                )}
              </div>

              {/* Model info */}
              <p className="text-[10px] text-zinc-400">
                Model: {result.model_version} · {new Date(result.created_at).toLocaleString()}
              </p>
            </div>
          )}

          {!result && !busy && viewState !== "error" && (
            <FlowCallout tone="caution">
              No AI analysis yet for this finding. Click "Re-analyze" to generate one.
            </FlowCallout>
          )}
        </div>
      )}
    </div>
  );
}
