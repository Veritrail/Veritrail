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

function TabIcon({ d }: { d: string }) {
  return (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const SECTION_ICONS: Record<SectionId, string> = {
  scanning: "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z",
  notifications:
    "M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0",
  detection:
    "M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15",
  trust:
    "M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z",
  auditors:
    "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
  records:
    "M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z",
  advanced:
    "M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5",
};

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-bold tracking-tight text-zinc-950">{title}</h2>
      <p className="mt-0.5 text-sm leading-relaxed text-zinc-500">{description}</p>
    </div>
  );
}

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
  const [active, setActive] = useState<SectionId>(() => {
    if (typeof window === "undefined") return "scanning";
    const h = window.location.hash.replace("#", "") as SectionId;
    return h in SECTION_ICONS ? h : "scanning";
  });

  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const lastSavedJson = useRef<string>("");

  const minCustomHours = data?.scan_status.min_custom_hours ?? 6;
  const canDaily = data?.scan_status.max_interval === "daily";

  useEffect(() => {
    if (typeof window !== "undefined") window.history.replaceState(null, "", `#${active}`);
  }, [active]);

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
  const alertsOn = scanFailureEnabled || criticalAlertEnabled || emailDigestEnabled;

  const activeAuditors = (auditorList.data ?? []).filter(
    (a) => a.is_active && new Date(a.expires_at) > new Date(),
  ).length;

  const scanBadge = !scanEnabled
    ? "Manual"
    : freqMode === "custom"
      ? "Custom"
      : freqMode === "weekly"
        ? "Weekly"
        : "Daily";

  const SECTIONS: { id: SectionId; label: string; badge?: string }[] = [
    { id: "scanning", label: "Scanning", badge: scanBadge },
    { id: "notifications", label: "Notifications", badge: alertsOn ? "On" : "Off" },
    { id: "detection", label: "Detection scope", badge: `${enabledOptional}/${optionalTotal}` },
    { id: "trust", label: "Trust Center", badge: trustCenter.data?.is_enabled ? "Live" : "Off" },
    { id: "auditors", label: "Auditor access", badge: activeAuditors ? String(activeAuditors) : undefined },
    { id: "records", label: "Evidence records", badge: vaultStatus.data?.enabled ? "On" : vaultStatus.data?.configured ? "Set" : "Off" },
    { id: "advanced", label: "Advanced", badge: aiFindingReviewEnabled ? "On" : "Off" },
  ];

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
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          {/* Section rail */}
          <nav className="flex gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-2 shadow-sm shadow-zinc-950/[0.02] lg:sticky lg:top-4 lg:w-60 lg:shrink-0 lg:flex-col lg:overflow-visible">
            {SECTIONS.map((s) => {
              const isActive = active === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActive(s.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition lg:shrink ${
                    isActive
                      ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/70"
                      : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                  }`}
                >
                  <TabIcon d={SECTION_ICONS[s.id]} />
                  <span className="whitespace-nowrap">{s.label}</span>
                  {s.badge && (
                    <span
                      className={`ml-auto hidden rounded-full px-1.5 py-0.5 text-[10px] font-bold lg:inline ${
                        isActive ? "bg-white text-indigo-600 ring-1 ring-indigo-200" : "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {s.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Section content */}
          <div className="min-w-0 flex-1 lg:max-w-3xl">
            {active === "scanning" && (
              <section>
                <SectionHeader title="Scanning" description="Vigil collects evidence and refreshes findings and compliance on a schedule." />
                <PageCard>
                  <SettingRow title="Automated scans" description="Runs evidence collection on a schedule and refreshes findings/compliance.">
                    <Toggle checked={scanEnabled} onChange={setScanEnabled} />
                  </SettingRow>
                  {scanEnabled && (
                    <div className="grid gap-3 border-t border-zinc-100 px-4 py-3 sm:grid-cols-[1fr_10rem]">
                      <div>
                        <label htmlFor="scan-interval" className="mb-1.5 block text-xs font-semibold text-zinc-600">Frequency</label>
                        <select id="scan-interval" value={freqMode} onChange={(e) => setFreqMode(e.target.value as FreqMode)} className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500/25">
                          <option value="daily" disabled={!canDaily}>Daily{canDaily ? "" : " (paid plan)"}</option>
                          <option value="weekly">Weekly</option>
                          <option value="custom">Custom interval</option>
                        </select>
                        <p className="mt-1.5 text-xs text-zinc-400">{scanScheduleLabel}</p>
                      </div>
                      {freqMode === "custom" && (
                        <div>
                          <label htmlFor="custom-hours" className="mb-1.5 block text-xs font-semibold text-zinc-600">Hours</label>
                          <input id="custom-hours" type="number" min={minCustomHours} max={720} step={1} value={customHours} onChange={(e) => setCustomHours(Number(e.target.value))} className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500/25" />
                          <p className="mt-1.5 text-xs text-zinc-400">{minCustomHours}–720</p>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="border-t border-zinc-100 bg-zinc-50/60 px-4 py-2 text-xs text-zinc-500">
                    {!data?.scan_status.account_connected ? <span>Connect an AWS account to enable scheduled scans.</span> : <span>{lastScan ? <>Last scan: {lastScan}</> : "No scan completed yet."}{scanEnabled && nextScan && <>{" · "}Next: {nextScan}</>}</span>}
                  </div>
                </PageCard>
              </section>
            )}

            {active === "notifications" && (
              <section className="space-y-5">
                <SectionHeader title="Notifications" description="Where Vigil sends scan-failure alerts and weekly posture summaries." />
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
              </section>
            )}

            {active === "detection" && (
              <section className="space-y-5">
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
            )}

            {active === "trust" && (
              <section>
                <SectionHeader title="Trust Center" description="Your public compliance and security page for auditors and prospects." />
                <PageCard className="border-indigo-200/60 bg-indigo-50/[0.15]">
                  <div className="px-1 py-1">
                    <TrustCenterSettings />
                  </div>
                </PageCard>
              </section>
            )}

            {active === "auditors" && (
              <section>
                <SectionHeader title="Auditor access" description="Invite external auditors with scoped, time-boxed read access." />
                <AuditorManagement />
              </section>
            )}

            {active === "records" && (
              <section>
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
            )}

            {active === "advanced" && (
              <section>
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
            )}
          </div>
        </div>
      </PageShell>
    </ProductShell>
  );
}
