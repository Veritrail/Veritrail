import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";

type Onboarding = { mode: string | null };

export function CloudTrailOnboardingChoice({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["cloudtrail-onboarding", accountId],
    queryFn: () => api<Onboarding>(`/v1/accounts/${accountId}/cloudtrail-onboarding`),
  });

  const save = useMutation({
    mutationFn: (mode: "existing" | "veritrail_managed") =>
      api<Onboarding>(`/v1/accounts/${accountId}/cloudtrail-onboarding`, {
        method: "PATCH",
        body: JSON.stringify({ mode }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cloudtrail-onboarding", accountId] }),
  });

  const mode = data?.mode;

  return (
    <div className="rounded-lg border border-sky-100 bg-sky-50/60 px-4 py-3 text-sm text-zinc-700">
      <p className="font-semibold text-zinc-900">CloudTrail onboarding</p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-600">
        Veritrail never auto-provisions trails silently. Choose whether this account already has an org or local trail, or
        whether you plan to deploy a Veritrail-managed trail via remediation.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isLoading || save.isPending}
          onClick={() => save.mutate("existing")}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ${
            mode === "existing"
              ? "bg-white text-sky-800 ring-sky-300"
              : "bg-white/70 text-zinc-700 ring-zinc-200 hover:ring-zinc-300"
          }`}
        >
          Use existing trail
        </button>
        <button
          type="button"
          disabled={isLoading || save.isPending}
          onClick={() => save.mutate("veritrail_managed")}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ring-1 ${
            mode === "veritrail_managed"
              ? "bg-white text-sky-800 ring-sky-300"
              : "bg-white/70 text-zinc-700 ring-zinc-200 hover:ring-zinc-300"
          }`}
        >
          Deploy Veritrail-managed trail
        </button>
      </div>
      {mode === "veritrail_managed" && (
        <p className="mt-2 text-xs text-zinc-600">
          Enable CloudTrail remediation in connection options, then deploy the remediation stack from{" "}
          <Link to="/accounts" className="font-semibold text-sky-800 hover:underline">
            Accounts
          </Link>
          . Findings for missing trails remain until the trail is active.
        </p>
      )}
    </div>
  );
}
