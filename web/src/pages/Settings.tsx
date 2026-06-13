import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, formatApiError } from "../api";
import { CHECK_FRAMEWORK_MAP } from "../data/checkFrameworkMap";
import { PageCard, PageShell } from "../components/PageShell";
import { ProductShell } from "../components/ProductShell";
import { InfoTip, Toggle } from "../components/SettingsUi";
import { AuditorManagement } from "../components/AuditorManagement";
import { TrustCenterSettings } from "../components/TrustCenterSettings";

type ScanInterval = "daily" | "weekly" | "custom" | "manual";
type FreqMode = "daily" | "weekly" | "custom";
type SaveStatus = "idle" | "saving" | "saved" | "error";
type SectionId = "scanning" | "notifications" | "detection" | "trust" | "auditors" | "records" | "advanced";

type OptionalCheck = {
  check_id: string;
  label: string;
  summary: string;
  description: string;
  enabled: boolean;
  default_enabled: boolean;
};

type SettingsData = {
  optional_checks: OptionalCheck[];
  features: {
    ai_finding_review_enabled: boolean;
  };
  scanning: {
    enabled: boolean;
    interval: ScanInterval;
    custom_hours: number | null;
  };
  notifications: {
    email_digest_enabled: boolean;
    digest_email: string | null;
    slack_webhook_url: string | null;
    scan_failure_email_enabled: boolean;
    critical_alert_enabled: boolean;
  };
  scan_status: {
    account_connected: boolean;
    last_scan_at: string | null;
    next_scan_at: string | null;
    max_interval: "daily" | "weekly";
    min_custom_hours: number;
  };
  account_email: string | null;
};

const BENCHMARK_CHECK_COUNT = Object.keys(CHECK_FRAMEWORK_MAP).length;

function SaveIndicator({ status, error }: { status: SaveStatus; error?: string }) {
  if (status === "idle") return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm ${
        status === "error"
          ? "border-red-200 bg-red-50 text-red-700"
          : status === "saved"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-zinc-200 bg-white text-zinc-500"
      }`}
    >
      {status === "saving" && (
        <>
          <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 5.373 0 0 12h4z" />
          </svg>
          Saving
        </>
      )}
      {status === "saved" && "Saved"}
      {status === "error" && (error ?? "Could not save")}
    </span>
  );
}

function formatWhen(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatCustomHours(hours: number) {
  if (hours % 168 === 0) return `every ${hours / 168} week${hours / 168 === 1 ? "" : "s"}`;
  if (hours % 24 === 0) return `every ${hours / 24} day${hours / 24 === 1 ? "" : "s"}`;
  return `every ${hours} hours`;
}

function buildPayload(state: {
  scanEnabled: boolean;
  freqMode: FreqMode;
  customHours: number;
  scanFailureEnabled: boolean;
  criticalAlertEnabled: boolean;
  emailDigestEnabled: boolean;
  digestEmail: string;
  slackWebhookUrl: string;
  aiFindingReviewEnabled: boolean;
}) {
  return {
    features: {
      ai_finding_review_enabled: state.aiFindingReviewEnabled,
    },
    scanning: {
      enabled: state.scanEnabled,
      interval: state.scanEnabled
        ? state.freqMode === "custom"
          ? "custom"
          : state.freqMode
        : "manual",
      custom_hours: state.scanEnabled && state.freqMode === "custom" ? state.customHours : null,
    },
    notifications: {
      email_digest_enabled: state.emailDigestEnabled,
      digest_email: state.digestEmail.trim() || null,
      slack_webhook_url: state.slackWebhookUrl.trim() || null,
      scan_failure_email_enabled: state.scanFailureEnabled,
      critical_alert_enabled: state.criticalAlertEnabled,
    },
  };
}

function SettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-900">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function TextField({ id, label, value, onChange, placeholder, type = "text", monospace = false }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; monospace?: boolean }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-zinc-600">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 shadow-inner shadow-zinc-950/[0.02] placeholder:text-zinc-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500/25 ${monospace ? "font-mono text-xs" : ""}`}
      />
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-bold tracking-tight text-zinc-950">{title}</h2>
      <p className="mt-0.5 text-sm leading-relaxed text-zinc-500">{description}</p>
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-full border border-zinc-200 bg-zinc-100/70 p-1">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
              active
                ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200/80"
                : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const SETTINGS_CARD = "rounded-xl border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-950/[0.02]";

export default function Settings() {
  const qc = useQueryClient();
  const vaultStatus = useQuery({
    queryKey: ["evidence-vault-status"],
    queryFn: () =>
      api<{ enabled: boolean; configured: boolean; s3_uri: string | null; retention_days: number | null; object_lock_mode: string | null; auditor_access_mode: string | null; implementation: string }>("/v1/meta/evidence-vault-status"),
  });

  const { data, isLoading } = useQuery<SettingsData>({ queryKey: ["settings"], queryFn: () => api("/v1/settings") });

  // Lightweight reads for tab status badges — these share TanStack cache keys with
  // <TrustCenterSettings /> and <AuditorManagement />, so they add no extra requests.
  const trustCenter = useQuery<{ is_enabled: boolean }>({
    queryKey: ["trust-center-settings"],
    queryFn: () => api("/v1/settings/trust-center"),
  });
  const auditorList = useQuery<{ is_active: boolean; expires_at: string }[]>({
    queryKey: ["auditor-list"],
    queryFn: () => api("/v1/auditor/list"),
  });

  // Optional-check toggles (moved here from the old Detection page). Optimistic local
  // state, debounced PATCH /v1/settings { checks } so a quick double-toggle saves once.
  const [optionalChecks, setOptionalChecks] = useState<Record<string, boolean>>({});
  const [checksHydrated, setChecksHydrated] = useState(false);
  const checksTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!data || checksHydrated) return;
    const map: Record<string, boolean> = {};
    for (const c of data.optional_checks ?? []) map[c.check_id] = c.enabled;
    setOptionalChecks(map);
    setChecksHydrated(true);
  }, [data, checksHydrated]);

  const checksMutation = useMutation({
    mutationFn: (checks: Record<string, { enabled: boolean }>) =>
      api("/v1/settings", { method: "PATCH", body: JSON.stringify({ checks }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  function toggleOptionalCheck(checkId: string) {
    setOptionalChecks((prev) => {
      const fallback = data?.optional_checks.find((c) => c.check_id === checkId)?.default_enabled ?? false;
      const current = prev[checkId] ?? fallback;
      const next = { ...prev, [checkId]: !current };
      clearTimeout(checksTimer.current);
      checksTimer.current = setTimeout(() => {
        const payload: Record<string, { enabled: boolean }> = {};
        for (const [id, en] of Object.entries(next)) payload[id] = { enabled: en };
        checksMutation.mutate(payload);
      }, 450);
      return next;
    });
  }

  useEffect(() => () => clearTimeout(checksTimer.current), []);

  const [scanEnabled, setScanEnabled] = useState(true);
  const [freqMode, setFreqMode] = useState<FreqMode>("daily");
  const [customHours, setCustomHours] = useState(24);
  const [scanFailureEnabled, setScanFailureEnabled] = useState(true);
  const [criticalAlertEnabled, setCriticalAlertEnabled] = useState(true);
  const [emailDigestEnabled, setEmailDigestEnabled] = useState(false);
  const [digestEmail, setDigestEmail] = useState("");
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [aiFindingReviewEnabled, setAiFindingReviewEnabled] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [slackTestState, setSlackTestState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [slackTestError, setSlackTestError] = useState("");

  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const lastSavedJson = useRef<string>("");

  const minCustomHours = data?.scan_status.min_custom_hours ?? 6;
  const canDaily = data?.scan_status.max_interval === "daily";

  useEffect(() => {
    if (!data) return;
    setScanEnabled(data.scanning.enabled);
    const interval = data.scanning.interval;
    if (interval === "custom") {
      setFreqMode("custom");
      setCustomHours(data.scanning.custom_hours ?? 24);
    } else if (interval === "weekly") {
      setFreqMode("weekly");
    } else {
      setFreqMode(canDaily ? "daily" : "weekly");
    }
    setScanFailureEnabled(data.notifications.scan_failure_email_enabled ?? true);
    setCriticalAlertEnabled(data.notifications.critical_alert_enabled ?? true);
    setEmailDigestEnabled(data.notifications.email_digest_enabled ?? false);
    setDigestEmail(data.notifications.digest_email ?? "");
    setSlackWebhookUrl(data.notifications.slack_webhook_url ?? "");
    setAiFindingReviewEnabled(data.features?.ai_finding_review_enabled ?? true);
    lastSavedJson.current = JSON.stringify(
      buildPayload({
        scanEnabled: data.scanning.enabled,
        freqMode: interval === "custom" ? "custom" : interval === "weekly" ? "weekly" : canDaily ? "daily" : "weekly",
        customHours: data.scanning.custom_hours ?? 24,
        scanFailureEnabled: data.notifications.scan_failure_email_enabled ?? true,
        criticalAlertEnabled: data.notifications.critical_alert_enabled ?? true,
        emailDigestEnabled: data.notifications.email_digest_enabled ?? false,
        digestEmail: data.notifications.digest_email ?? "",
        slackWebhookUrl: data.notifications.slack_webhook_url ?? "",
        aiFindingReviewEnabled: data.features?.ai_finding_review_enabled ?? true,
      }),
    );
    setHydrated(true);
  }, [data, canDaily]);

  const optionalTotal = data?.optional_checks.length ?? 0;
  const enabledOptional = useMemo(
    () => (data?.optional_checks ?? []).filter((c) => optionalChecks[c.check_id] ?? c.enabled).length,
    [data, optionalChecks],
  );

  const scanScheduleLabel = useMemo(() => {
    if (!scanEnabled) return "Manual only";
    if (freqMode === "weekly") return "Every 7 days";
    if (freqMode === "custom") return formatCustomHours(customHours);
    return "Every 24 hours";
  }, [scanEnabled, freqMode, customHours]);

  const mutation = useMutation({
    mutationFn: (body: ReturnType<typeof buildPayload>) => api("/v1/settings", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["ai-triage"] });
      lastSavedJson.current = JSON.stringify(variables);
      setSaveStatus("saved");
      setSaveError("");
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
    onError: (err) => {
      setSaveStatus("error");
      setSaveError(formatApiError(err));
    },
  });

  const formState = useMemo(
    () => ({
      scanEnabled,
      freqMode,
      customHours,
      scanFailureEnabled,
      criticalAlertEnabled,
      emailDigestEnabled,
      digestEmail,
      slackWebhookUrl,
      aiFindingReviewEnabled,
    }),
    [scanEnabled, freqMode, customHours, scanFailureEnabled, criticalAlertEnabled, emailDigestEnabled, digestEmail, slackWebhookUrl, aiFindingReviewEnabled],
  );

  useEffect(() => {
    if (!hydrated) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const payload = buildPayload(formState);
      const json = JSON.stringify(payload);
      if (json === lastSavedJson.current) return;
      setSaveStatus("saving");
      mutation.mutate(payload);
    }, 600);
  }, [formState, hydrated, mutation]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  async function sendSlackTest() {
    setSlackTestState("sending");
    setSlackTestError("");
    try {
      await api("/v1/settings/test-slack", { method: "POST", body: JSON.stringify({ url: slackWebhookUrl.trim() }) });
      setSlackTestState("sent");
      setTimeout(() => setSlackTestState("idle"), 3000);
    } catch (e) {
      setSlackTestState("error");
      setSlackTestError(formatApiError(e));
      setTimeout(() => setSlackTestState("idle"), 4000);
    }
  }

  if (isLoading) return <div className="flex h-64 w-full items-center justify-center text-sm text-zinc-400">Loading settings…</div>;

  const lastScan = formatWhen(data?.scan_status.last_scan_at ?? null);
  const nextScan = formatWhen(data?.scan_status.next_scan_at ?? null);
  const slackConnected = slackWebhookUrl.trim().length > 0;
  const deliveryPlaceholder = data?.account_email ?? "you@company.com";
  const vaultLabel = vaultStatus.data?.enabled ? "Enabled" : vaultStatus.data?.configured ? "Configured" : "Not configured";

  return (
    <ProductShell>
      <PageShell
        variant="compact"
        eyebrow="Workspace controls"
        title="Settings"
        description="Scan cadence, alerts, detection scope, evidence records, and auditor-facing pages."
        actions={<SaveIndicator status={saveStatus} error={saveError} />}
        width="w-full"
      >
        <div className="w-full space-y-10">
            <section id="scanning">
                <SectionHeader title="Scanning" description="Vigil collects evidence and refreshes findings and compliance on a schedule." />
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className={SETTINGS_CARD}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900">Automated scans</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">Collect evidence and refresh findings on a schedule.</p>
                      </div>
                      <Toggle checked={scanEnabled} onChange={setScanEnabled} />
                    </div>
                    {scanEnabled && (
                      <div className="mt-5 border-t border-zinc-100 pt-4">
                        <p className="mb-2 text-xs font-semibold text-zinc-600">Frequency</p>
                        <Segmented
                          value={freqMode}
                          onChange={(v) => setFreqMode(v as FreqMode)}
                          options={[
                            { value: "daily", label: canDaily ? "Daily" : "Daily · paid", disabled: !canDaily },
                            { value: "weekly", label: "Weekly" },
                            { value: "custom", label: "Custom" },
                          ]}
                        />
                        {freqMode === "custom" && (
                          <div className="mt-3 flex items-center gap-2">
                            <input
                              type="number"
                              min={minCustomHours}
                              max={720}
                              step={1}
                              value={customHours}
                              onChange={(e) => setCustomHours(Number(e.target.value))}
                              className="w-24 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
                            />
                            <span className="text-xs text-zinc-500">hours ({minCustomHours}–720)</span>
                          </div>
                        )}
                        <p className="mt-3 text-xs text-zinc-400">{scanScheduleLabel}</p>
                      </div>
                    )}
                  </div>

                  <div className={SETTINGS_CARD}>
                    <p className="text-sm font-semibold text-zinc-900">Scan status</p>
                    {!data?.scan_status.account_connected ? (
                      <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-800">
                        Connect an AWS account to enable scheduled scans.
                      </p>
                    ) : (
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <div className="rounded-lg border border-zinc-100 bg-zinc-50/70 px-3.5 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Last scan</p>
                          <p className="mt-1.5 text-[13px] font-semibold leading-snug text-zinc-900">{lastScan ?? "No scan yet"}</p>
                        </div>
                        <div className="rounded-lg border border-zinc-100 bg-zinc-50/70 px-3.5 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Next scan</p>
                          <p className="mt-1.5 text-[13px] font-semibold leading-snug text-zinc-900">{scanEnabled ? nextScan ?? "—" : "Manual only"}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>

            <section id="notifications">
                <SectionHeader title="Notifications" description="Where Vigil sends scan-failure alerts and weekly posture summaries." />
                <div className="grid items-start gap-4 lg:grid-cols-2">
                <PageCard title="Email alerts" description="Failure alerts and weekly summaries share one delivery address.">
                  <SettingRow title="Scan failure email" description="Notify when a scan fails or loses AWS access.">
                    <Toggle checked={scanFailureEnabled} onChange={setScanFailureEnabled} />
                  </SettingRow>
                  <div className="border-t border-zinc-100">
                    <SettingRow title="Critical finding alerts" description="Notify immediately (email + Slack) when a scan opens new critical or high findings.">
                      <Toggle checked={criticalAlertEnabled} onChange={setCriticalAlertEnabled} />
                    </SettingRow>
                  </div>
                  <div className="border-t border-zinc-100">
                    <SettingRow title="Weekly email digest" description="Findings summary every Monday at 9:00 UTC.">
                      <Toggle checked={emailDigestEnabled} onChange={setEmailDigestEnabled} />
                    </SettingRow>
                  </div>
                  {(scanFailureEnabled || criticalAlertEnabled || emailDigestEnabled) && (
                    <div className="border-t border-zinc-100 px-4 py-3">
                      <TextField id="delivery-email" label="Delivery email" type="email" value={digestEmail} onChange={setDigestEmail} placeholder={deliveryPlaceholder} />
                    </div>
                  )}
                </PageCard>

                <PageCard
                  title="Slack"
                  description="Incoming webhook for operational notifications."
                  action={
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${slackConnected ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60" : "bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200/80"}`}>
                      {slackConnected ? "Connected" : "Not connected"}
                    </span>
                  }
                >
                  <div className="space-y-2.5 px-4 py-3">
                    <TextField id="slack-webhook" label="Webhook URL" type="url" value={slackWebhookUrl} onChange={setSlackWebhookUrl} placeholder="https://hooks.slack.com/services/…" monospace />
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={sendSlackTest} disabled={slackTestState === "sending" || !slackWebhookUrl.trim()} className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:opacity-50">
                        {slackTestState === "sending" ? "Sending…" : "Send test"}
                      </button>
                      {slackTestState === "sent" && <span className="text-xs font-medium text-emerald-600">Delivered</span>}
                      {slackTestState === "error" && <span className="text-xs text-red-600">{slackTestError}</span>}
                    </div>
                  </div>
                </PageCard>
                </div>
              </section>

            <section id="detection" className="space-y-5">
                <SectionHeader title="Detection scope" description="What Vigil scans and what counts toward your compliance score." />
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-zinc-600">
                  <span><strong className="font-semibold text-zinc-900">{BENCHMARK_CHECK_COUNT}</strong> benchmark checks · always on</span>
                  <span><strong className="font-semibold text-zinc-900">{enabledOptional}</strong>/{optionalTotal} optional enabled</span>
                </div>
                <PageCard
                  title="Optional security checks"
                  description="Optional modules are not included in compliance scoring unless enabled. Changes apply after the next scan."
                  action={
                    <span className="text-xs font-medium text-zinc-500">
                      {enabledOptional} of {optionalTotal} enabled
                    </span>
                  }
                >
                  <div className="grid grid-cols-1 gap-2.5 p-4 lg:grid-cols-2">
                    {(data?.optional_checks ?? []).map((check) => {
                      const enabled = optionalChecks[check.check_id] ?? check.default_enabled;
                      return (
                        <div
                          key={check.check_id}
                          className={`rounded-lg border p-3 transition ${
                            enabled
                              ? "border-sky-200/70 bg-white shadow-sm shadow-sky-950/[0.03] ring-1 ring-sky-500/5"
                              : "border-dashed border-zinc-200/90 bg-white shadow-sm shadow-zinc-950/[0.02] hover:border-zinc-300/90"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                enabled
                                  ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200/60"
                                  : "bg-zinc-50 text-zinc-600 ring-1 ring-zinc-200/70"
                              }`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-sky-500" : "bg-zinc-300"}`} aria-hidden />
                              {enabled ? "On" : "Off"}
                            </span>
                            <Toggle checked={enabled} onChange={() => toggleOptionalCheck(check.check_id)} />
                          </div>
                          <div className="mt-2 flex items-start gap-1.5">
                            <h3 className="text-sm font-semibold text-zinc-900">{check.label}</h3>
                            <InfoTip text={check.description} />
                          </div>
                          <p className="mt-0.5 text-xs leading-snug text-zinc-600">{check.summary}</p>
                          <p className="mt-1.5 font-mono text-[10px] text-zinc-400">{check.check_id}</p>
                          {enabled ? (
                            <p className="mt-1.5 text-[11px] text-sky-700">Shows in Findings. Compliance pass/fail unchanged unless benchmark-mapped.</p>
                          ) : (
                            <p className="mt-1.5 text-[11px] text-zinc-400">Off — not scanned.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {(data?.optional_checks ?? []).length === 0 && (
                    <p className="py-8 text-center text-sm text-zinc-400">No optional capabilities available.</p>
                  )}
                </PageCard>
              </section>

            <section id="trust">
                <SectionHeader title="Trust Center" description="Your public compliance and security page for auditors and prospects." />
                <PageCard className="border-indigo-200/60 bg-indigo-50/[0.15]">
                  <div className="px-1 py-1">
                    <TrustCenterSettings />
                  </div>
                </PageCard>
              </section>

            <section id="auditors">
                <SectionHeader title="Auditor access" description="Invite external auditors with scoped, time-boxed read access." />
                <AuditorManagement />
              </section>

            <section id="records">
                <SectionHeader title="Evidence records" description="Immutable archive for signed evidence packs." />
                <PageCard>
                  <div className="px-4 py-3 text-sm">
                    {vaultStatus.isLoading && <p className="text-xs text-zinc-400">Loading vault status…</p>}
                    {vaultStatus.data && (
                      <div className="space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className={`text-sm font-semibold ${vaultStatus.data.enabled ? "text-emerald-700" : "text-amber-700"}`}>{vaultLabel}</span>
                          {vaultStatus.data.enabled && (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200/60">
                              Object Lock
                            </span>
                          )}
                        </div>
                        {vaultStatus.data.s3_uri && (
                          <p className="break-all rounded-lg bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-700 ring-1 ring-zinc-100">{vaultStatus.data.s3_uri}</p>
                        )}
                        {vaultStatus.data.enabled && vaultStatus.data.retention_days != null && (
                          <p className="text-xs text-zinc-500">
                            {vaultStatus.data.retention_days}-day retention
                            {vaultStatus.data.object_lock_mode ? ` · ${vaultStatus.data.object_lock_mode}` : ""}
                          </p>
                        )}
                        <p className="text-xs leading-relaxed text-zinc-500">
                          {vaultStatus.data.enabled
                            ? "Evidence packs can be written to your immutable vault. Contact your Vigil operator to change retention or access."
                            : "Immutable evidence storage is not active for this workspace. Your operator can enable the evidence vault in deployment settings."}
                        </p>
                      </div>
                    )}
                  </div>
                </PageCard>
              </section>

            <section id="advanced">
                <SectionHeader title="Advanced" description="Optional and experimental features. No compliance-score impact." />
                <PageCard>
                  <SettingRow
                    title="AI finding review"
                    description="Advisory summaries in finding drawers when an LLM is configured."
                  >
                    <Toggle checked={aiFindingReviewEnabled} onChange={setAiFindingReviewEnabled} />
                  </SettingRow>
                </PageCard>
              </section>
        </div>
      </PageShell>
    </ProductShell>
  );
}
