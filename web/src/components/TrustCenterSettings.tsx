import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { trustCenterPublicUrl } from "../lib/appOrigin";
import { ToggleChipBar } from "./FilterChipBar";
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

function ExternalLinkIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H18m0 0v4.5M18 6l-7.5 7.5M6 18h12" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
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
    <div className="workspace-trust">
      <div className="workspace-notifications-routes">
        <div className="workspace-route-row workspace-route-row--ok">
          <span className="workspace-route-row__icon" aria-hidden>
            <ShieldIcon />
          </span>
          <div className="workspace-route-row__copy">
            <p className="workspace-route-row__title">Public security profile</p>
            <p className="workspace-route-row__description">
              Make your Trust Center profile accessible to anyone with the link.
            </p>
          </div>
          <div className="workspace-route-row__control">
            <span className={`workspace-route-badge workspace-route-badge--${enabled ? "ok" : "idle"}`}>
              {enabled ? "Live" : "Off"}
            </span>
            <Toggle checked={enabled} onChange={handleEnabledChange} />
          </div>
        </div>
      </div>

      {enabled && (
        <div className="workspace-trust__body">
          <div className="workspace-destination-row">
            <span className="workspace-destination-row__icon" aria-hidden>
              <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </span>
            <div className="workspace-field">
              <label>Included frameworks</label>
              <ToggleChipBar
                className="workspace-trust__framework-bar"
                ariaLabel="Included frameworks"
                chips={AVAILABLE_FRAMEWORKS.map((fw) => ({ id: fw.key, label: fw.label }))}
                selected={frameworks}
                onChange={toggleFramework}
              />
            </div>
          </div>

          <div className="workspace-destination-row">
            <span className="workspace-destination-row__icon" aria-hidden>
              <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
              </svg>
            </span>
            <div className="workspace-field">
              <label>Public profile link</label>
              <div className="workspace-destination-input">
                <input
                  type="text"
                  readOnly
                  value={publicUrl || "Set a URL slug in Configure profile"}
                />
                <button
                  type="button"
                  onClick={copyPublicUrl}
                  disabled={!publicUrl}
                  className="workspace-trust__url-copy"
                  aria-label="Copy public profile link"
                >
                  {copyMsg ? copyMsg : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75m6 12H9.75m3 0h3.375m-3.75-3h.008v-.008H12v.008Zm0 0h.008v-.008H12V15m0 3.75h3.375M15.75 9h.008v-.008H15.75V9Zm0 3.75h.008v-.008H15.75V12.75Zm-3.75 0h.008v-.008H12v.008Zm0 0h.008v-.008H12V9Zm0 3.75h.008v-.008H12v.008Z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          {configureOpen && (
            <div className="workspace-trust__configure">
              <div className="workspace-trust__notice">
                <p className="workspace-trust__notice-title">Before you publish</p>
                <p className="workspace-trust__notice-copy">
                  The public page shows monitoring status, frameworks, and document availability only. It does not
                  expose finding counts, pass/fail scores, or resource names.
                </p>
                <label className="workspace-trust__notice-check">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                  />
                  <span>I understand what is — and is not — shown publicly.</span>
                </label>
              </div>

              <div className="workspace-form-grid">
                <div className="workspace-field">
                  <label htmlFor="trust-slug">Public URL slug</label>
                  <input
                    id="trust-slug"
                    type="text"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="cloud-castles"
                  />
                </div>
                <div className="workspace-field">
                  <label htmlFor="trust-company">Company name</label>
                  <input
                    id="trust-company"
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Cloud Castles"
                  />
                </div>
                <div className="workspace-field">
                  <label htmlFor="trust-logo">Company logo URL (optional)</label>
                  <input
                    id="trust-logo"
                    type="url"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://example.com/logo.png"
                  />
                </div>
                <div className="workspace-field" style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor="trust-message">Intro message (optional)</label>
                  <textarea
                    id="trust-message"
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    placeholder="We take your security seriously…"
                    rows={3}
                    className="workspace-trust__textarea"
                  />
                </div>
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
              className="vigil-toolbar-btn"
            >
              {mutation.isPending ? "Saving…" : configureOpen ? "Save profile" : "Configure profile"}
            </button>
            {saveMsg && <span className="text-xs font-semibold text-emerald-600">{saveMsg}</span>}
            {configureOpen && !canSave && (
              <span className="text-xs text-amber-700">Confirm the disclosure to save.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
