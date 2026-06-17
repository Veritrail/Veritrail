import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { trustCenterPublicUrl } from "../lib/appOrigin";
import { Toggle } from "./SettingsUi";

type TrustCenterSettings = {
  is_enabled: boolean;
  subdomain_slug: string | null;
  company_name: string | null;
  company_logo_url: string | null;
  frameworks_to_show: string[];
  custom_message: string | null;
  configured: boolean;
};

type SavePayload = {
  is_enabled: boolean;
  subdomain_slug: string;
  company_name: string;
  company_logo_url: string | null;
  frameworks_to_show: string[];
  custom_message: string | null;
};

const AVAILABLE_FRAMEWORKS = [
  { key: "soc2", label: "SOC 2" },
  { key: "iso27001", label: "ISO 27001" },
  { key: "cis_aws_l1", label: "CIS AWS L1" },
];

const DEFAULT_FRAMEWORKS = ["soc2", "iso27001", "cis_aws_l1"];
const TRUST_FRAMEWORK_KEYS = new Set(DEFAULT_FRAMEWORKS);

function normalizeFrameworks(keys: string[] | undefined): string[] {
  const filtered = (keys ?? []).filter((key) => TRUST_FRAMEWORK_KEYS.has(key));
  return filtered.length ? filtered : DEFAULT_FRAMEWORKS;
}

function CheckIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H18m0 0v4.5M18 6l-7.5 7.5M6 18h12" />
    </svg>
  );
}

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
  const [frameworks, setFrameworks] = useState<string[]>(DEFAULT_FRAMEWORKS);
  const [customMessage, setCustomMessage] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [copyMsg, setCopyMsg] = useState("");

  useEffect(() => {
    if (!data || hydrated) return;
    setEnabled(data.is_enabled);
    setSlug(data.subdomain_slug || "");
    setCompanyName(data.company_name || "");
    setLogoUrl(data.company_logo_url || "");
    setFrameworks(normalizeFrameworks(data.frameworks_to_show));
    setCustomMessage(data.custom_message || "");
    setAcknowledged(data.is_enabled);
    setHydrated(true);
  }, [data, hydrated]);

  function buildPayload(override?: Partial<SavePayload>): SavePayload {
    return {
      is_enabled: override?.is_enabled ?? enabled,
      subdomain_slug: override?.subdomain_slug ?? slug,
      company_name: override?.company_name ?? companyName,
      company_logo_url: override?.company_logo_url ?? (logoUrl || null),
      frameworks_to_show: normalizeFrameworks(override?.frameworks_to_show ?? frameworks),
      custom_message: override?.custom_message ?? (customMessage || null),
    };
  }

  const mutation = useMutation({
    mutationFn: (override?: Partial<SavePayload>) =>
      api("/v1/settings/trust-center", {
        method: "PUT",
        body: JSON.stringify(buildPayload(override)),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trust-center-settings"] });
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(""), 2000);
    },
  });

  const canSave = !enabled || acknowledged;
  const publicUrl = slug ? trustCenterPublicUrl(slug) : "";

  function toggleFramework(key: string) {
    setFrameworks((prev) => (prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]));
  }

  function handleEnabledChange(next: boolean) {
    setEnabled(next);
    if (!next) setAcknowledged(false);
    mutation.mutate({ is_enabled: next });
  }

  function copyPublicUrl() {
    if (!publicUrl) return;
    void navigator.clipboard.writeText(publicUrl).then(() => {
      setCopyMsg("Copied");
      setTimeout(() => setCopyMsg(""), 2000);
    });
  }

  if (isLoading) {
    return <p className="text-xs text-zinc-400">Loading trust center settings…</p>;
  }

  return (
    <div className="workspace-trust space-y-5">
      <div className="workspace-trust__toggle-row">
        <div>
          <p className="workspace-trust__label">Enable public security profile</p>
          <p className="workspace-trust__hint">
            Make your Trust Center profile accessible to anyone with the link.
          </p>
        </div>
        <Toggle checked={enabled} onChange={handleEnabledChange} />
      </div>

      {enabled && (
        <>
          <div>
            <p className="workspace-trust__section-label">Included frameworks</p>
            <div className="workspace-trust__frameworks">
              {AVAILABLE_FRAMEWORKS.map((fw) => {
                const checked = frameworks.includes(fw.key);
                return (
                  <button
                    key={fw.key}
                    type="button"
                    onClick={() => toggleFramework(fw.key)}
                    className={`workspace-trust__framework-pill${checked ? " is-on" : ""}`}
                    aria-pressed={checked}
                  >
                    {checked && <CheckIcon />}
                    {fw.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="workspace-trust__section-label">Your public profile link</p>
            <div className="workspace-trust__url-field">
              <input
                type="text"
                readOnly
                value={publicUrl || "Set a URL slug in Configure profile"}
                className="workspace-trust__url-input"
              />
              <button
                type="button"
                onClick={copyPublicUrl}
                disabled={!publicUrl}
                className="workspace-trust__url-copy"
                aria-label="Copy public profile link"
              >
                {copyMsg ? (
                  <span className="workspace-trust__url-copy-text">{copyMsg}</span>
                ) : (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75m6 12H9.75m3 0h3.375m-3.75-3h.008v-.008H12v.008Zm0 0h.008v-.008H12V15m0 3.75h3.375M15.75 9h.008v-.008H15.75V9Zm0 3.75h.008v-.008H15.75V12.75Zm-3.75 0h.008v-.008H12v.008Zm0 0h.008v-.008H12V9Zm0 3.75h.008v-.008H12v.008Z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {configureOpen && (
            <div className="workspace-trust__configure space-y-3">
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-xs leading-relaxed text-amber-950">
                <p className="font-semibold">Before you publish</p>
                <p className="mt-1">
                  The public page shows monitoring status, frameworks, and document availability only. It does not
                  expose finding counts, pass/fail scores, or resource names.
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

              <div>
                <label className="workspace-trust__field-label">Public URL slug</label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="cloud-castles"
                  className="workspace-trust__field-input"
                />
              </div>
              <div>
                <label className="workspace-trust__field-label">Company name</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Cloud Castles"
                  className="workspace-trust__field-input"
                />
              </div>
              <div>
                <label className="workspace-trust__field-label">Company logo URL (optional)</label>
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                  className="workspace-trust__field-input"
                />
              </div>
              <div>
                <label className="workspace-trust__field-label">Intro message (optional)</label>
                <textarea
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  placeholder="We take your security seriously…"
                  rows={3}
                  className="workspace-trust__field-input resize-none"
                />
              </div>
            </div>
          )}

          <div className="workspace-trust__actions">
            {slug && (
              <a
                href={`/trust/${slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="vigil-toolbar-btn workspace-trust__preview-btn"
              >
                Preview profile
                <ExternalLinkIcon />
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                if (!configureOpen) {
                  setConfigureOpen(true);
                  return;
                }
                mutation.mutate({});
              }}
              disabled={mutation.isPending || (configureOpen && !canSave)}
              className="vigil-toolbar-btn workspace-btn--accent"
            >
              {mutation.isPending ? "Saving…" : configureOpen ? "Save profile" : "Configure profile"}
            </button>
            {saveMsg && <span className="text-xs font-semibold text-emerald-600">{saveMsg}</span>}
            {configureOpen && !canSave && (
              <span className="text-xs text-amber-700">Confirm the disclosure to save.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
