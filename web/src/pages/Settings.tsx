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
      <div className="mb-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">{eyebrow}</p>
        <h2 className="mt-1 text-base font-bold tracking-tight text-zinc-950">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

function SettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-900">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">{description}</p>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
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
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-zinc-500">
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
    <div className="w-full space-y-8 pb-10">
      <header className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm shadow-zinc-950/[0.04]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 bg-gradient-to-br from-zinc-50 via-white to-indigo-50/30 px-6 py-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-indigo-500">Workspace controls</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-950">Settings</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-500">Configure scans, delivery, coverage, evidence retention, Trust Center, and auditor access.</p>
          </div>
          <SaveIndicator status={saveStatus} error={saveError} />
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <OverviewCard label="Scan cadence" value={scanScheduleLabel} detail={nextScan ? `Next scan ${nextScan}` : lastScan ? `Last scan ${lastScan}` : "No scan completed yet"} tone="indigo" />
          <OverviewCard label="Coverage" value={`${BENCHMARK_CHECK_COUNT} checks`} detail={`${enabledOptional}/${optionalTotal} optional modules enabled`} />
          <OverviewCard label="Alerts" value={scanFailureEnabled ? "On" : "Off"} detail={emailDigestEnabled ? "Weekly digest enabled" : "Digest disabled"} tone={scanFailureEnabled ? "green" : "neutral"} />
          <OverviewCard label="Evidence vault" value={vaultLabel} detail={vaultStatus.data?.s3_uri ?? "Immutable archive target"} tone={vaultStatus.data?.enabled ? "green" : "amber"} />
        </div>
      </header>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="space-y-8">
          <SectionShell eyebrow="Operations" title="Scan schedule" description="Keep evidence fresh without making this page feel like an airplane dashboard.">
            <div className={settingsCardClass}>
              <SettingRow title="Automated scans" description="Runs evidence collection on a schedule and refreshes findings/compliance."><Toggle checked={scanEnabled} onChange={setScanEnabled} /></SettingRow>
              {scanEnabled && (
                <div className="grid gap-4 border-t border-zinc-100 px-4 py-4 sm:grid-cols-[1fr_10rem]">
                  <div>
                    <label htmlFor="scan-interval" className="mb-1.5 block text-xs font-semibold text-zinc-500">Frequency</label>
                    <select id="scan-interval" value={freqMode} onChange={(e) => setFreqMode(e.target.value as FreqMode)} className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500/25">
                      <option value="daily" disabled={!canDaily}>Daily{canDaily ? "" : " (paid plan)"}</option>
                      <option value="weekly">Weekly</option>
                      <option value="custom">Custom interval</option>
                    </select>
                    <p className="mt-2 text-xs text-zinc-400">{scanScheduleLabel}</p>
                  </div>
                  {freqMode === "custom" && (
                    <div>
                      <label htmlFor="custom-hours" className="mb-1.5 block text-xs font-semibold text-zinc-500">Hours</label>
                      <input id="custom-hours" type="number" min={minCustomHours} max={720} step={1} value={customHours} onChange={(e) => setCustomHours(Number(e.target.value))} className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500/25" />
                      <p className="mt-2 text-xs text-zinc-400">{minCustomHours}–720</p>
                    </div>
                  )}
                </div>
              )}
              <div className="border-t border-zinc-100 bg-zinc-50/60 px-4 py-3 text-xs text-zinc-500">
                {!data?.scan_status.account_connected ? <span>Connect an AWS account to enable scheduled scans.</span> : <span>{lastScan ? <>Last scan: {lastScan}</> : "No scan completed yet."}{scanEnabled && nextScan && <>{" · "}Next: {nextScan}</>}</span>}
              </div>
            </div>
          </SectionShell>

          <SectionShell eyebrow="Scope" title="Detection coverage" description="Benchmark checks are always active. Optional modules extend visibility beyond audit minimums.">
            <Link to="/detection" className="group block overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-950/[0.04] ring-1 ring-indigo-500/[0.06] transition hover:border-indigo-200 hover:ring-indigo-500/10">
              <div className="flex items-start justify-between gap-4">
                <div><p className="text-sm font-bold text-zinc-950">Detection coverage</p><p className="mt-1 text-sm leading-relaxed text-zinc-500">Manage benchmark mapping and optional operational checks.</p></div>
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-indigo-700 ring-1 ring-indigo-100">Subsystem</span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-100"><p className="text-xl font-bold tabular-nums text-zinc-950">{BENCHMARK_CHECK_COUNT}</p><p className="text-xs font-medium text-zinc-500">Benchmark checks</p></div>
                <div className="rounded-xl bg-zinc-50 p-3 ring-1 ring-zinc-100"><p className="text-xl font-bold tabular-nums text-zinc-950">{optionalTotal}</p><p className="text-xs font-medium text-zinc-500">Optional modules</p></div>
                <div className="rounded-xl bg-indigo-50/70 p-3 ring-1 ring-indigo-100"><p className="text-xl font-bold tabular-nums text-indigo-700">{enabledOptional}</p><p className="text-xs font-medium text-indigo-700/70">Enabled</p></div>
              </div>
              <p className="mt-4 text-sm font-semibold text-indigo-600 transition group-hover:text-indigo-800">Manage coverage →</p>
            </Link>
          </SectionShell>
        </div>

        <div className="space-y-8">
          <SectionShell eyebrow="Delivery" title="Alerts and reports" description="One delivery address, two jobs: failed-scan alerts and weekly posture summaries.">
            <div className={settingsCardClass}>
              <SettingRow title="Scan failure email" description="Notify when a scan fails or loses AWS access."><Toggle checked={scanFailureEnabled} onChange={setScanFailureEnabled} /></SettingRow>
              <SettingRow title="Weekly email digest" description="Scheduled findings summary every Monday at 9am UTC."><Toggle checked={emailDigestEnabled} onChange={setEmailDigestEnabled} /></SettingRow>
              {(scanFailureEnabled || emailDigestEnabled) && <div className="border-t border-zinc-100 px-4 py-4"><TextField id="delivery-email" label="Delivery email" type="email" value={digestEmail} onChange={setDigestEmail} placeholder={deliveryPlaceholder} /></div>}
            </div>
          </SectionShell>

          <SectionShell eyebrow="Integrations" title="Slack delivery" description="Webhook delivery for reports and operational notifications.">
            <div className={settingsCardClass}>
              <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#4A154B]/10 text-[#4A154B] ring-1 ring-[#4A154B]/15"><span className="text-sm font-black">#</span></div>
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-zinc-900">Slack</p><p className="text-xs text-zinc-500">Incoming webhook</p></div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${slackConnected ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60" : "bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200/80"}`}>{slackConnected ? "Connected" : "Not connected"}</span>
              </div>
              <div className="space-y-3 px-4 py-4">
                <TextField id="slack-webhook" label="Webhook URL" type="url" value={slackWebhookUrl} onChange={setSlackWebhookUrl} placeholder="https://hooks.slack.com/services/…" monospace />
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button type="button" onClick={sendSlackTest} disabled={slackTestState === "sending" || !slackWebhookUrl.trim()} className="rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:opacity-50">{slackTestState === "sending" ? "Sending…" : "Send test"}</button>
                  {slackTestState === "sent" && <span className="text-xs font-medium text-emerald-600">Delivered</span>}
                  {slackTestState === "error" && <span className="text-xs text-red-500">{slackTestError}</span>}
                </div>
              </div>
            </div>
          </SectionShell>

          <SectionShell eyebrow="Records" title="Evidence vault" description="Immutable storage target for evidence packs. Operator-controlled, shown here for visibility.">
            <div className={settingsCardClass}>
              {vaultStatus.isLoading && <p className="px-4 py-4 text-xs text-zinc-400">Loading vault status…</p>}
              {vaultStatus.data && (
                <div className="space-y-3 px-4 py-4 text-sm text-zinc-600">
                  <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm font-semibold text-zinc-900">{vaultLabel}</span>{vaultStatus.data.enabled && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200/60">Object Lock</span>}</div>
                  {vaultStatus.data.s3_uri && <p className="break-all rounded-xl bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-700 ring-1 ring-zinc-100">{vaultStatus.data.s3_uri}</p>}
                  {vaultStatus.data.enabled && vaultStatus.data.retention_days != null && <p className="text-xs text-zinc-500">{vaultStatus.data.object_lock_mode} · {vaultStatus.data.retention_days} day retention · auditor mode: {vaultStatus.data.auditor_access_mode}</p>}
                  <p className="text-xs leading-relaxed text-zinc-500">Configure <span className="font-mono text-zinc-700">EVIDENCE_VAULT_ENABLED</span> and <span className="font-mono text-zinc-700">EVIDENCE_VAULT_S3_URI</span> in the operator environment.</p>
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
