import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { trustCenterPublicUrl } from "../lib/appOrigin";
import { ToggleChipBar } from "./FilterChipBar";
import { TrustCenterPreviewMock } from "./TrustCenterPreviewMock";
import { Toggle } from "./SettingsUi";

type TrustCenterSettings = {
  is_enabled: boolean;
  subdomain_slug: string | null;
  company_name: string | null;
  company_logo_url: string | null;
  frameworks_to_show: string[];
  custom_message: string | null;
  configured: boolean;
  last_updated_at: string | null;
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

function GlobeIcon() {
  return (
    <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5a17.92 17.92 0 0 1-8.716-2.247m0 0A8.966 8.966 0 0 1 3 12c0-1.264.26-2.468.732-3.582" />
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

function GearIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
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
      api<TrustCenterSettings>("/v1/settings/trust-center", {
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
    setFrameworks((prev) => {
      let next = prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key];
      if (next.length === 0) next = [key];
      const normalized = normalizeFrameworks(next);
      mutation.mutate({ frameworks_to_show: normalized });
      return normalized;
    });
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
    <section className="sharing-trust-card">
      <header className="sharing-trust-card__header">
        <div className="sharing-trust-card__intro">
          <span className="sharing-well sharing-well--globe" aria-hidden>
            <GlobeIcon />
          </span>
          <div>
            <h3 className="sharing-trust-card__title">Trust Center</h3>
            <p className="sharing-trust-card__subtitle">
              A public security profile you control for prospects and customers.
            </p>
          </div>
        </div>
        <div className="sharing-trust-card__live">
          <span className={`sharing-live-pill${enabled ? " is-on" : ""}`}>{enabled ? "Live" : "Off"}</span>
          <Toggle checked={enabled} onChange={handleEnabledChange} />
        </div>
      </header>

      {enabled && (
        <>
          <div className="sharing-trust-card__body">
            <div className="sharing-trust-card__preview-column">
              <TrustCenterPreviewMock companyName={companyName} frameworks={frameworks} logoUrl={logoUrl || undefined} />
              <div className="sharing-trust-card__actions">
                {slug && (
                  <a
                    href={`/trust/${slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="sharing-btn sharing-btn--outline"
                  >
                    Preview profile
                    <ExternalLinkIcon />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setConfigureOpen(true)}
                  className="sharing-btn sharing-btn--outline"
                >
                  <GearIcon />
                  Configure profile
                </button>
              </div>
            </div>

            <div className="sharing-trust-card__settings">
              <h4 className="sharing-trust-card__settings-title">Make your profile public</h4>
              <p className="sharing-trust-card__settings-copy">
                Share your security posture, certifications, and policies with anyone — no login required.
              </p>

              <div className="sharing-field">
                <span className="sharing-field__label">Included frameworks</span>
                <ToggleChipBar
                  className="sharing-trust-card__framework-bar"
                  ariaLabel="Included frameworks"
                  chips={AVAILABLE_FRAMEWORKS.map((fw) => ({ id: fw.key, label: fw.label }))}
                  selected={frameworks}
                  onChange={toggleFramework}
                />
              </div>

              <div className="sharing-field">
                <span className="sharing-field__label">Public profile link</span>
                <div className="sharing-link-input">
                  <input
                    type="text"
                    readOnly
                    value={publicUrl || "Set a URL slug below"}
                  />
                  <button
                    type="button"
                    onClick={copyPublicUrl}
                    disabled={!publicUrl}
                    className="sharing-link-input__copy"
                    aria-label="Copy public profile link"
                  >
                    {copyMsg ? (
                      <svg className="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75m6 12H9.75m3 0h3.375m-3.75-3h.008v-.008H12v.008Zm0 0h.008v-.008H12V15m0 3.75h3.375M15.75 9h.008v-.008H15.75V9Zm0 3.75h.008v-.008H15.75V12.75Zm-3.75 0h.008v-.008H12v.008Zm0 0h.008v-.008H12V9Zm0 3.75h.008v-.008H12v.008Z" />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="sharing-field__hint">Anyone with the link can view your Trust Center.</p>
              </div>
            </div>
          </div>





          {configureOpen && (
            <div className="sharing-config-modal" role="dialog" aria-modal="true" aria-labelledby="trust-config-title">
              <button
                type="button"
                className="sharing-config-modal__backdrop"
                aria-label="Close profile settings"
                onClick={() => setConfigureOpen(false)}
              />
              <div className="sharing-config-modal__panel">
                <header className="sharing-config-modal__header">
                  <div>
                    <p className="workspace-panel__eyebrow">Trust Center</p>
                    <h3 id="trust-config-title">Configure profile</h3>
                    <p>Update the public profile details shown to prospects and reviewers.</p>
                  </div>
                  <button type="button" className="sharing-config-modal__close" aria-label="Close" onClick={() => setConfigureOpen(false)}>
                    <svg fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </header>

                <div className="sharing-config-modal__body">
                  <div className="sharing-config-modal__notice">
                    <p>Public disclosure</p>
                    <span>Public pages show monitoring status, frameworks, and document availability. They do not expose finding counts, scores, or resource names.</span>
                    <label>
                      <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                      <span>I understand what is shown publicly.</span>
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

                <footer className="sharing-config-modal__footer">
                  <button type="button" className="sharing-btn sharing-btn--outline" onClick={() => setConfigureOpen(false)}>Cancel</button>
                  <button
                    type="button"
                    onClick={() => mutation.mutate({})}
                    disabled={mutation.isPending || !canSave}
                    className="sharing-btn sharing-btn--primary"
                  >
                    {mutation.isPending ? "Saving…" : "Save profile"}
                  </button>
                  {saveMsg && <span className="text-xs font-semibold text-emerald-600">{saveMsg}</span>}
                  {!canSave && <span className="text-xs text-amber-700">Confirm the disclosure to save.</span>}
                </footer>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
