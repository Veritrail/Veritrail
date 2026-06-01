import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { CHECK_FRAMEWORK_MAP } from "../data/checkFrameworkMap";
import { settingsCardClass, Toggle } from "../components/SettingsUi";
import { AuditorManagement } from "../components/AuditorManagement";
import { TrustCenterSettings } from "../components/TrustCenterSettings";

type ScanInterval = "daily" | "weekly" | "custom" | "manual";
type FreqMode = "daily" | "weekly" | "custom";
type SaveStatus = "idle" | "saving" | "saved" | "error";

type OptionalCheck = {
  check_id: string;
  enabled: boolean;
  default_enabled: boolean;
};

type SettingsData = {
  optional_checks: OptionalCheck[];
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
  emailDigestEnabled: boolean;
  digestEmail: string;
  slackWebhookUrl: string;
}) {
  return {
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
    },
  };
}

function SectionShell({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">{eyebrow}</p>
        <h2 className="mt-0.5 text-sm font-bold tracking-tight text-zinc-950">{title}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{description}</p>
      </div>
      {children}
    </section>
  );
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

function OverviewCard({ label, value, detail, tone = "neutral" }: { label: string; value: string | number; detail: string; tone?: "neutral" | "green" | "indigo" | "amber" }) {
  const toneClass =
    tone === "green"
      ? "from-emerald-50 to-white ring-emerald-100"
      : tone === "indigo"
        ? "from-indigo-50 to-white ring-indigo-100"
        : tone === "amber"
          ? "from-amber-50 to-white ring-amber-100"
          : "from-zinc-50 to-white ring-zinc-100";
  return (
    <div className={`rounded-2xl border border-zinc-200 bg-gradient-to-br ${toneClass} p-4 shadow-sm shadow-zinc-950/[0.03] ring-1`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-400">{label}</p>
      <p className="mt-2 truncate text-xl font-bold tracking-tight text-zinc-950">{value}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">{detail}</p>
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

export default function Settings() {
  const qc = useQueryClient();
  const vaultStatus = useQuery({
    queryKey: ["evidence-vault-status"],
    queryFn: () =>
      api<{ enabled: boolean; configured: boolean; s3_uri: string | null; retention_days: number | null; object_lock_mode: string | null; auditor_access_mode: string | null; implementation: string }>("/v1/meta/evidence-vault-status"),
  });

  const { data, isLoading } = useQuery<SettingsData>({ queryKey: ["settings"], queryFn: () => api("/v1/settings") });

  const [scanEnabled, setScanEnabled] = useState(true);
  const [freqMode, setFreqMode] = useState<FreqMode>("daily");
  const [customHours, setCustomHours] = useState(24);
  const [scanFailureEnabled, setScanFailureEnabled] = useState(true);
  const [emailDigestEnabled, setEmailDigestEnabled] = useState(false);
  const [digestEmail, setDigestEmail] = useState("");
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
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
    setEmailDigestEnabled(data.notifications.email_digest_enabled ?? false);
    setDigestEmail(data.notifications.digest_email ?? "");
    setSlackWebhookUrl(data.notifications.slack_webhook_url ?? "");
    lastSavedJson.current = JSON.stringify(
      buildPayload({
        scanEnabled: data.scanning.enabled,
        freqMode: interval === "custom" ? "custom" : interval === "weekly" ? "weekly" : canDaily ? "daily" : "weekly",
        customHours: data.scanning.custom_hours ?? 24,
        scanFailureEnabled: data.notifications.scan_failure_email_enabled ?? true,
        emailDigestEnabled: data.notifications.email_digest_enabled ?? false,
        digestEmail: data.notifications.digest_email ?? "",
        slackWebhookUrl: data.notifications.slack_webhook_url ?? "",
      }),
    );
    setHydrated(true);
  }, [data, canDaily]);

  const optionalTotal = data?.optional_checks.length ?? 0;
  const enabledOptional = useMemo(() => (data?.optional_checks ?? []).filter((c) => c.enabled).length, [data]);

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
      lastSavedJson.current = JSON.stringify(variables);
      setSaveStatus("saved");
      setSaveError("");
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
    onError: (err) => {
      setSaveStatus("error");
      setSaveError((err as Error).message);
    },
  });

  const formState = useMemo(() => ({ scanEnabled, freqMode, customHours, scanFailureEnabled, emailDigestEnabled, digestEmail, slackWebhookUrl }), [scanEnabled, freqMode, customHours, scanFailureEnabled, emailDigestEnabled, digestEmail, slackWebhookUrl]);

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
      setSlackTestError((e as Error).message);
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
    <div className="w-full max-w-5xl space-y-5 pb-10">
      <header className="rounded-2xl border border-zinc-200 bg-white shadow-sm shadow-zinc-950/[0.03]">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-100 bg-gradient-to-br from-zinc-50 via-white to-indigo-50/30 px-4 py-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-500">Workspace controls</p>
            <h1 className="mt-0.5 text-xl font-bold tracking-tight text-zinc-950">Settings</h1>
          </div>
          <SaveIndicator status={saveStatus} error={saveError} />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-indigo-100 p-1.5 text-indigo-700">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </span>
            <div><span className="text-sm font-semibold text-zinc-800">{scanScheduleLabel}</span><span className="ml-1.5 text-xs text-zinc-400">{nextScan ? `Next scan ${nextScan}` : lastScan ? `Last scan ${lastScan}` : "No scan yet"}</span></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-emerald-100 p-1.5 text-emerald-700">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
            </span>
            <div><span className="text-sm font-semibold text-zinc-800">{BENCHMARK_CHECK_COUNT} checks</span><span className="ml-1.5 text-xs text-zinc-400">{enabledOptional}/{optionalTotal} optional enabled</span></div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-lg p-1.5 ${scanFailureEnabled ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
            </span>
            <div><span className="text-sm font-semibold text-zinc-800">{scanFailureEnabled ? "Alerts on" : "Alerts off"}</span><span className="ml-1.5 text-xs text-zinc-400">{emailDigestEnabled ? "Digest enabled" : "Digest off"}</span></div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-lg p-1.5 ${vaultStatus.data?.enabled ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
            </span>
            <div><span className="text-sm font-semibold text-zinc-800">{vaultLabel}</span><span className="ml-1.5 text-xs text-zinc-400">{vaultStatus.data?.s3_uri ?? "Immutable archive"}</span></div>
          </div>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-5">
          <SectionShell eyebrow="Operations" title="Scan schedule" description="Keep evidence fresh without making this page feel like an airplane dashboard.">
            <div className={settingsCardClass}>
              <SettingRow title="Automated scans" description="Runs evidence collection on a schedule and refreshes findings/compliance."><Toggle checked={scanEnabled} onChange={setScanEnabled} /></SettingRow>
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
            </div>
          </SectionShell>

          <SectionShell eyebrow="Scope" title="Detection coverage" description="Benchmark checks are always active. Optional modules extend visibility beyond audit minimums.">
            <Link to="/detection" className="group block rounded-xl border border-zinc-200 bg-white p-4 shadow-sm shadow-zinc-950/[0.02] ring-1 ring-indigo-500/[0.06] transition hover:border-indigo-200 hover:ring-indigo-500/10">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-sm font-bold text-zinc-950">Detection coverage</p><p className="mt-0.5 text-xs leading-relaxed text-zinc-500">Manage benchmark mapping and optional operational checks.</p></div>
                <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700 ring-1 ring-indigo-100">Subsystem</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg bg-zinc-50 p-2.5 ring-1 ring-zinc-100"><p className="text-lg font-bold tabular-nums text-zinc-950">{BENCHMARK_CHECK_COUNT}</p><p className="text-xs font-medium text-zinc-500">Benchmark checks</p></div>
                <div className="rounded-lg bg-zinc-50 p-2.5 ring-1 ring-zinc-100"><p className="text-lg font-bold tabular-nums text-zinc-950">{optionalTotal}</p><p className="text-xs font-medium text-zinc-500">Optional modules</p></div>
                <div className="rounded-lg bg-indigo-50/70 p-2.5 ring-1 ring-indigo-100"><p className="text-lg font-bold tabular-nums text-indigo-700">{enabledOptional}</p><p className="text-xs font-medium text-indigo-700/70">Enabled</p></div>
              </div>
              <p className="mt-3 text-xs font-semibold text-indigo-600 transition group-hover:text-indigo-800">Manage coverage →</p>
            </Link>
          </SectionShell>
        </div>

        <div className="space-y-5">
          <SectionShell eyebrow="Delivery" title="Alerts and reports" description="One delivery address, two jobs: failed-scan alerts and weekly posture summaries.">
            <div className={settingsCardClass}>
              <SettingRow title="Scan failure email" description="Notify when a scan fails or loses AWS access."><Toggle checked={scanFailureEnabled} onChange={setScanFailureEnabled} /></SettingRow>
              <SettingRow title="Weekly email digest" description="Scheduled findings summary every Monday at 9am UTC."><Toggle checked={emailDigestEnabled} onChange={setEmailDigestEnabled} /></SettingRow>
              {(scanFailureEnabled || emailDigestEnabled) && <div className="border-t border-zinc-100 px-4 py-3"><TextField id="delivery-email" label="Delivery email" type="email" value={digestEmail} onChange={setDigestEmail} placeholder={deliveryPlaceholder} /></div>}
            </div>
          </SectionShell>

          <SectionShell eyebrow="Integrations" title="Slack delivery" description="Webhook delivery for reports and operational notifications.">
            <div className={settingsCardClass}>
              <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#4A154B]/10 text-[#4A154B] ring-1 ring-[#4A154B]/15"><span className="text-sm font-black">#</span></div>
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-zinc-900">Slack</p><p className="text-xs text-zinc-500">Incoming webhook</p></div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${slackConnected ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60" : "bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200/80"}`}>{slackConnected ? "Connected" : "Not connected"}</span>
              </div>
              <div className="space-y-2.5 px-4 py-3">
                <TextField id="slack-webhook" label="Webhook URL" type="url" value={slackWebhookUrl} onChange={setSlackWebhookUrl} placeholder="https://hooks.slack.com/services/…" monospace />
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={sendSlackTest} disabled={slackTestState === "sending" || !slackWebhookUrl.trim()} className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:opacity-50">{slackTestState === "sending" ? "Sending…" : "Send test"}</button>
                  {slackTestState === "sent" && <span className="text-xs font-medium text-emerald-600">Delivered</span>}
                  {slackTestState === "error" && <span className="text-xs text-red-500">{slackTestError}</span>}
                </div>
              </div>
            </div>
          </SectionShell>

          <SectionShell eyebrow="Records" title="Evidence vault" description="Immutable storage target for evidence packs.">
            <div className={settingsCardClass}>
              {vaultStatus.isLoading && <p className="px-4 py-3 text-xs text-zinc-400">Loading vault status…</p>}
              {vaultStatus.data && (
                <div className="space-y-2.5 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className={`text-sm font-semibold ${vaultStatus.data.enabled ? "text-emerald-700" : "text-amber-700"}`}>{vaultLabel}</span>
                    {vaultStatus.data.enabled && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200/60">Object Lock</span>}
                  </div>
                  {vaultStatus.data.s3_uri && <p className="break-all rounded-lg bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-700 ring-1 ring-zinc-100">{vaultStatus.data.s3_uri}</p>}
                  {vaultStatus.data.enabled && vaultStatus.data.retention_days != null && <p className="text-xs text-zinc-500">{vaultStatus.data.object_lock_mode} · {vaultStatus.data.retention_days} day retention · auditor mode: {vaultStatus.data.auditor_access_mode}</p>}
                  {!vaultStatus.data.enabled ? (
                    <p className="text-xs leading-relaxed text-zinc-500">Set <span className="font-mono text-zinc-700">EVIDENCE_VAULT_ENABLED</span> and <span className="font-mono text-zinc-700">EVIDENCE_VAULT_S3_URI</span> in the operator environment to activate immutable evidence storage.</p>
                  ) : (
                    <p className="text-xs leading-relaxed text-zinc-500">Evidence vault is active. Configuration is managed in the operator environment.</p>
                  )}
                </div>
              )}
            </div>
          </SectionShell>
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-2">
        <TrustCenterSettings />
        <AuditorManagement />
      </div>
    </div>
  );
}
