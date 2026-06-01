import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, BASE } from "../api";
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

  useEffect(() => {
    if (!data || hydrated) return;
    setEnabled(data.is_enabled);
    setSlug(data.subdomain_slug || "");
    setCompanyName(data.company_name || "");
    setLogoUrl(data.company_logo_url || "");
    setFrameworks(data.frameworks_to_show || ["soc2", "cis_aws_l1"]);
    setCustomMessage(data.custom_message || "");
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

  if (isLoading) {
    return <p className="text-xs text-zinc-400">Loading trust center settings…</p>;
  }

  return (
    <div className="space-y-4 px-3 pb-3">
      <div className={`${settingsCardClass} p-5 space-y-4`}>
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-900">Enable Trust Center</p>
            <p className="text-xs text-zinc-500">Public compliance transparency page for prospects and customers.</p>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} />
        </div>

        {enabled && (
          <>
            <div className="border-t border-zinc-100 pt-4 space-y-3">
              {/* Subdomain slug */}
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Subdomain slug</label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="your-company"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-[11px] text-zinc-400">
                  {slug ? `${BASE}/trust/${slug}` : "e.g. your-company → /trust/your-company"}
                </p>
              </div>

              {/* Company name */}
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

              {/* Logo URL */}
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

              {/* Frameworks to show */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-500">Frameworks to display</label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_FRAMEWORKS.map((fw) => {
                    const checked = frameworks.includes(fw.key);
                    return (
                      <label
                        key={fw.key}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium cursor-pointer transition ${
                          checked
                            ? "border-indigo-300 bg-indigo-50 text-indigo-700"
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

              {/* Custom message */}
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Custom message (optional)</label>
                <textarea
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  placeholder="We take your security seriously…"
                  rows={3}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm resize-none"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 border-t border-zinc-100 pt-4">
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}
