import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, formatApiError } from "../api";
import { FlowBadge, FlowCallout } from "./FindingDrawerSemantic";

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

type TriageFetchResponse =
  | TriageResultPayload
  | {
      ai_triage_enabled?: boolean;
      llm_configured?: boolean;
      config_error?: string | null;
      result?: TriageResultPayload | null;
    };

/* ---------- helpers ---------- */

function isTriageResultPayload(value: unknown): value is TriageResultPayload {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Partial<TriageResultPayload>;
  return (
    typeof maybe.id === "string" &&
    typeof maybe.finding_id === "string" &&
    typeof maybe.confidence_score === "number" &&
    typeof maybe.rationale === "string" &&
    typeof maybe.suggested_action === "string"
  );
}

function normalizeTriageResponse(resp: TriageFetchResponse): {
  enabled: boolean;
  llmConfigured: boolean;
  configError: string | null;
  result: TriageResultPayload | null;
} {
  if (isTriageResultPayload(resp)) {
    return { enabled: true, llmConfigured: true, configError: null, result: resp };
  }

  const enabled = resp.ai_triage_enabled !== false;
  const llmConfigured = resp.llm_configured !== false;
  return {
    enabled,
    llmConfigured,
    configError: typeof resp.config_error === "string" ? resp.config_error : null,
    result: isTriageResultPayload(resp.result) ? resp.result : null,
  };
}

function verdictForScore(score: number): { label: string; detail: string; className: string } {
  if (score >= 0.8) {
    return {
      label: "Likely real issue",
      detail: "High true-positive confidence",
      className: "border-red-200 bg-red-50 text-red-700",
    };
  }
  if (score >= 0.5) {
    return {
      label: "Needs review",
      detail: "Moderate true-positive confidence",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }
  return {
    label: "Likely noise",
    detail: "Low true-positive confidence",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
}

function actionBadge(action: string): { label: string; variant: "high" | "caution" | "muted" } {
  switch (action) {
    case "resolve":
      return { label: "Fix recommended", variant: "high" };
    case "review":
      return { label: "Human review", variant: "caution" };
    case "snooze":
      return { label: "Snooze candidate", variant: "muted" };
    case "ignore":
      return { label: "Ignore candidate", variant: "muted" };
    default:
      return { label: action, variant: "muted" };
  }
}

function actionSummary(action: string): string {
  switch (action) {
    case "resolve":
      return "Treat as actionable. Use remediation or re-check after fixing.";
    case "review":
      return "Keep open until a human confirms the context.";
    case "snooze":
      return "Possibly benign. Consider postponing with an audit note.";
    case "ignore":
      return "Likely false positive. Ignore only after a human confirms.";
    default:
      return "Use this as advisory context only.";
  }
}

/* ---------- sub-components ---------- */

function TriageSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="h-5 w-32 rounded bg-zinc-100" />
        <div className="h-5 w-20 rounded bg-zinc-100" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full rounded bg-zinc-100" />
        <div className="h-3 w-4/5 rounded bg-zinc-100" />
      </div>
    </div>
  );
}

function TriageError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-100 bg-red-50/50 px-3 py-2.5 text-xs text-red-700">
      <div className="flex items-start justify-between gap-2">
        <span>Failed to load AI review: {message}</span>
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 font-semibold text-red-600 underline hover:text-red-800"
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
    data: triageState,
    isLoading: loadingResult,
    refetch: refetchTriage,
  } = useQuery({
    queryKey: ["ai-triage", findingId],
    queryFn: async () => {
      const resp = await api<TriageFetchResponse>(`/v1/findings/${findingId}/triage`);
      return normalizeTriageResponse(resp);
    },
    enabled: !!findingId,
    staleTime: 120_000,
    refetchInterval: viewState === "loading" ? 3000 : false,
    retry: 1,
  });

  const triggerTriage = useMutation({
    mutationFn: async () =>
      api<TriageTriggerResponse>(`/v1/findings/${findingId}/triage`, { method: "POST" }),
    onMutate: () => {
      setErrorMsg("");
      setViewState("loading");
    },
    onSuccess: (data) => {
      if (!data?.queued) {
        refetchTriage()
          .then(({ data: refreshed }) => {
            setViewState(refreshed?.result ? "done" : "idle");
          })
          .catch(() => {
            setErrorMsg("Failed to retrieve review");
            setViewState("error");
          });
        return;
      }
      setTimeout(() => {
        refetchTriage()
          .then(({ data: refreshed }) => {
            setViewState(refreshed?.result ? "done" : "loading");
          })
          .catch(() => {
            setErrorMsg("Failed to retrieve review");
            setViewState("error");
          });
      }, 2500);
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

  if (triageState?.enabled === false) return null;

  const result = triageState?.result ?? null;
  const isLocalReview = result?.model_version === "veritrail-local-review-v1";
  const busy = loadingResult || triggerTriage.isPending || viewState === "loading";
  const verdict = result ? verdictForScore(result.confidence_score) : null;
  const action = result ? actionBadge(result.suggested_action) : null;

  return (
    <div className="border-b border-zinc-100 px-4 py-3">
      <div className="rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50/60 via-white to-white px-3.5 py-3 shadow-sm shadow-violet-950/[0.03]">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={onToggle}
            className="flex min-w-0 flex-1 items-start gap-2 text-left"
          >
            <svg
              className={`mt-0.5 h-4 w-4 shrink-0 text-violet-500 transition-transform ${expanded ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-zinc-900">AI review</span>
              {result && verdict ? (
                <span className="mt-1 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${verdict.className}`}
                  >
                    {Math.round(result.confidence_score * 100)}% · {verdict.label}
                  </span>
                  {action && <FlowBadge variant={action.variant}>{action.label}</FlowBadge>}
                </span>
              ) : (
                <span className="mt-1 block text-xs text-zinc-500">
                  {isLocalReview
                    ? "Rules-based review (no external LLM). Advisory only."
                    : "Advisory only. It does not change compliance score unless a human applies an action."}
                </span>
              )}
            </span>
          </button>

          <button
            type="button"
            onClick={() => triggerTriage.mutate()}
            disabled={busy}
            className="shrink-0 rounded-lg border border-violet-100 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 shadow-sm transition hover:bg-violet-50 disabled:opacity-50"
          >
            {busy ? "Reviewing…" : result ? "Re-review" : "Run review"}
          </button>
        </div>

        {busy && !result && <div className="mt-3"><TriageSkeleton /></div>}

        {viewState === "error" && !result && (
          <div className="mt-3">
            <TriageError message={errorMsg} onRetry={handleRetry} />
          </div>
        )}

        {expanded && result && verdict && action && (
          <div className="mt-3 space-y-3 border-t border-violet-100/70 pt-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-zinc-200/70 bg-white px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Verdict</p>
                <p className="mt-1 text-sm font-semibold text-zinc-900">{verdict.label}</p>
                <p className="mt-0.5 text-[11px] text-zinc-500">{verdict.detail}</p>
              </div>
              <div className="rounded-lg border border-zinc-200/70 bg-white px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Suggested next step</p>
                <p className="mt-1 text-sm font-semibold text-zinc-900">{action.label}</p>
                <p className="mt-0.5 text-[11px] text-zinc-500">{actionSummary(result.suggested_action)}</p>
              </div>
            </div>

            <div className="rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2.5">
              <p className="text-xs leading-relaxed text-zinc-700">{result.rationale}</p>
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] text-zinc-400">
                Model: {result.model_version} · {new Date(result.created_at).toLocaleString()}
              </p>
              {onApplyAction && result.suggested_action !== "review" && (
                <button
                  type="button"
                  onClick={() => onApplyAction(result.suggested_action)}
                  className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 transition hover:bg-violet-100 active:scale-95"
                >
                  Use suggestion
                </button>
              )}
            </div>
          </div>
        )}

        {expanded && !result && !busy && viewState !== "error" && (
          <div className="mt-3">
            <FlowCallout title="AI review" tone="neutral">
              No AI review yet for this finding. Click “Run review” to generate one.
            </FlowCallout>
          </div>
        )}
      </div>
    </div>
  );
}
