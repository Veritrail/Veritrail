type GeneratedPolicy = {
  confidence?: "high" | "medium" | "low";
  observed_action_count?: number;
  source_label?: string | null;
};

/** Shown only when SSM may run (high-confidence proposal). */
export function IamPolicyAutomationGate({
  generatedPolicy,
  isLoading,
}: {
  generatedPolicy?: GeneratedPolicy;
  isLoading: boolean;
}) {
  if (isLoading || generatedPolicy?.confidence !== "high") {
    return null;
  }

  const actionCount = generatedPolicy.observed_action_count ?? 0;
  return (
    <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/60 px-3 py-2.5 text-[12px] leading-relaxed text-emerald-950">
      <p className="font-semibold">High-confidence proposal ready</p>
      <p className="mt-1 text-emerald-900/90">
        SSM will apply the reviewed least-privilege policy
        {actionCount > 0 ? ` (${actionCount} observed actions)` : ""} from{" "}
        {generatedPolicy.source_label ?? "IAM + CloudTrail analysis"}.
      </p>
      <p className="mt-1.5 text-[11px] text-emerald-900/70">
        Scoped from the last 90 days of CloudTrail — confirm any low-frequency workloads
        (quarterly jobs, DR roles) ran in that window before applying.
      </p>
    </div>
  );
}
