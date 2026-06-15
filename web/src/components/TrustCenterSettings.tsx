import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { trustCenterPublicUrl } from "../lib/appOrigin";
import { settingsCardClass, Toggle } from "./SettingsUi";

type TrustCenterSettings = {
  is_enabled: boolean;
  subdomain_slug: string | null;
  company_name: string | null;
  company_logo_url: string | null;
  frameworks_to_show: string[];
  custom_message: string | null;
  configured: boolean;
};

const AVAILABLE_FRAMEWORKS = [
  { key: "soc2", label: "SOC 2" },
  { key: "cis_aws_l1", label: "CIS AWS Foundations L1" },
  { key: "iso27001", label: "ISO 27001" },
];

export function TrustCenterSettings() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<TrustCenterSettings>({
    queryKey: ["trust-center-settings"],
    queryFn: () => api("/v1/settings/trust-center"),
  });

  const [enabled, setEnabled] = useState(false);
  const [slug, setSlug] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [frameworks, setFrameworks] = useState<string[]>(["soc2", "cis_aws_l1"]);
  const [customMessage, setCustomMessage] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!data || hydrated) return;
    setEnabled(data.is_enabled);
    setSlug(data.subdomain_slug || "");
    setCompanyName(data.company_name || "");
    setLogoUrl(data.company_logo_url || "");
    setFrameworks(data.frameworks_to_show || ["soc2", "cis_aws_l1"]);
    setCustomMessage(data.custom_message || "");
    setAcknowledged(data.is_enabled);
    setHydrated(true);
  }, [data, hydrated]);

  const mutation = useMutation({
    mutationFn: () =>
      api("/v1/settings/trust-center", {
        method: "PUT",
        body: JSON.stringify({
          is_enabled: enabled,
          subdomain_slug: slug,
          company_name: companyName,
          company_logo_url: logoUrl || null,
          frameworks_to_show: frameworks,
          custom_message: customMessage || null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trust-center-settings"] });
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(""), 2000);
    },
  });

  const canSave = !enabled || acknowledged;

  if (isLoading) {
    return <p className="text-xs text-zinc-400">Loading trust center settings…</p>;
  }

  return (
    <div className="space-y-4 px-3 pb-3">
      <div className={`${settingsCardClass} space-y-4 p-5`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-900">Enable public security profile</p>
            <p className="text-xs text-zinc-500">
              A marketing-safe summary for prospects and customers — not a live compliance scorecard.
            </p>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} />
        </div>

        {enabled && (
          <>
            <div className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-xs leading-relaxed text-amber-950">
              <p className="font-semibold">Before you publish</p>
              <p className="mt-1">
                The public page shows monitoring status, frameworks, and document availability only. It does{" "}
                <strong>not</strong> expose finding counts, pass/fail scores, control gaps, account IDs, or resource
                names. Detailed evidence stays in the auditor portal.
              </p>
              <label className="mt-3 flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-700 focus:ring-amber-400"
                />
                <span>I understand what is — and is not — shown publicly.</span>
              </label>
            </div>

            <div className="space-y-3 border-t border-zinc-100 pt-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Public URL slug</label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="your-company"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-[11px] text-zinc-400">
                  {slug ? trustCenterPublicUrl(slug) : "e.g. your-company → /trust/your-company"}
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Company name</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="ACME Corp"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Company logo URL (optional)</label>
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-500">Frameworks to list</label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_FRAMEWORKS.map((fw) => {
                    const checked = frameworks.includes(fw.key);
                    return (
                      <label
                        key={fw.key}
                        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                          checked
                            ? "border-[#439385]/40 bg-[#439385]/10 text-[#2f6d63]"
                            : "border-zinc-200 bg-white text-zinc-600"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            if (checked) {
                              setFrameworks(frameworks.filter((f) => f !== fw.key));
                            } else {
                              setFrameworks([...frameworks, fw.key]);
                            }
                          }}
                          className="sr-only"
                        />
                        {fw.label}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Intro message (optional)</label>
                <textarea
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  placeholder="We take your security seriously…"
                  rows={3}
                  className="w-full resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 border-t border-zinc-100 pt-4">
              <button
                type="button"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || !canSave}
                className="rounded-lg bg-[#439385] px-4 py-2 text-sm font-semibold text-white hover:bg-[#367a6f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {mutation.isPending ? "Saving…" : "Save"}
              </button>
              {slug && (
                <a
                  href={`/trust/${slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-50"
                >
                  Preview ↗
                </a>
              )}
              {saveMsg && <span className="text-xs font-medium text-emerald-600">{saveMsg}</span>}
              {!canSave && (
                <span className="text-xs text-amber-700">Confirm the disclosure above to save.</span>
              )}
            </div>
          </>
        )}

        {!enabled && (
          <div className="flex items-center gap-3 border-t border-zinc-100 pt-4">
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="rounded-lg bg-[#439385] px-4 py-2 text-sm font-semibold text-white hover:bg-[#367a6f] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mutation.isPending ? "Saving…" : "Save"}
            </button>
            {saveMsg && <span className="text-xs font-medium text-emerald-600">{saveMsg}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
