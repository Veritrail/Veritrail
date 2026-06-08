type GeneratedPolicy = {
  confidence?: "high" | "medium" | "low";
  confidence_note?: string | null;
  observed_action_count?: number;
  source_label?: string | null;
};

export function IamPolicyAutomationGate({
  generatedPolicy,
  isLoading,
}: {
  generatedPolicy?: GeneratedPolicy;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <p className="text-[12px] text-zinc-500">Loading least-privilege proposal…</p>;
  }

  if (generatedPolicy?.confidence === "high") {
    const actionCount = generatedPolicy.observed_action_count ?? 0;
    return (
      <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/60 px-3 py-2.5 text-[12px] leading-relaxed text-emerald-950">
        <p className="font-semibold">High-confidence proposal ready</p>
        <p className="mt-1 text-emerald-900/90">
          SSM will apply the reviewed least-privilege policy
          {actionCount > 0 ? ` (${actionCount} observed actions)` : ""} from{" "}
          {generatedPolicy.source_label ?? "IAM + CloudTrail analysis"}.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2.5 text-[12px] leading-relaxed text-amber-950">
      <p className="font-semibold">
        {generatedPolicy?.confidence === "medium" ? "Medium confidence" : "Proposal not ready for automation"}
      </p>
      <p className="mt-1">
        {generatedPolicy?.confidence_note ??
          "Automated fix requires a high-confidence least-privilege proposal."}
      </p>
      <p className="mt-2 text-[11px] text-amber-900/85">
        Use <span className="font-semibold">Suggested policy</span> for CloudTrail analysis and rebuild. Return here
        when confidence is high to run SSM.
      </p>
    </div>
  );
}
