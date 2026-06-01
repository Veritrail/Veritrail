import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
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

function ColumnHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">{title}</h2>
      <p className="mt-1 text-xs text-zinc-500">{description}</p>
    </div>
  );
}

function SettingRow({
  title,
  description,
  children,
  compact,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 px-4 ${compact ? "py-2.5" : "py-3"}`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-900">{title}</p>
        <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

function SaveIndicator({ status, error }: { status: SaveStatus; error?: string }) {
  if (status === "idle") return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
        status === "error" ? "text-red-600" : status === "saved" ? "text-emerald-600" : "text-zinc-400"
      }`}
    >
      {status === "saving" && (
        <>
          <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Saving…
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
  if (hours % 168 === 0) return `about every ${hours / 168} week${hours / 168 === 1 ? "" : "s"}`;
  if (hours % 24 === 0) return `about every ${hours / 24} day${hours / 24 === 1 ? "" : "s"}`;
  return `about every ${hours} hours`;
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

export default function Settings() {
  const qc = useQueryClient();
  const vaultStatus = useQuery({
    queryKey: ["evidence-vault-status"],
    queryFn: () =>
      api<{
        enabled: boolean;
        configured: boolean;
        s3_uri: string | null;
        retention_days: number | null;
        object_lock_mode: string | null;
        auditor_access_mode: string | null;
        implementation: string;
      }>("/v1/meta/evidence-vault-status"),
  });

  const { data, isLoading } = useQuery<SettingsData>({
    queryKey: ["settings"],
    queryFn: () => api("/v1/settings"),
  });

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
  const enabledOptional = useMemo(
    () => (data?.optional_checks ?? []).filter((c) => c.enabled).length,
    [data],
  );

  const scanScheduleLabel = useMemo(() => {
    if (!scanEnabled) return "Manual only — trigger from Findings or Compliance.";
    if (freqMode === "weekly") return "Runs about every 7 days.";
    if (freqMode === "custom") return `Runs ${formatCustomHours(customHours)}.`;
    return "Runs about every 24 hours.";
  }, [scanEnabled, freqMode, customHours]);

  const mutation = useMutation({
    mutationFn: (body: ReturnType<typeof buildPayload>) =>
      api("/v1/settings", { method: "PATCH", body: JSON.stringify(body) }),
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

  const formState = useMemo(
    () => ({
      scanEnabled,
      freqMode,
      customHours,
      scanFailureEnabled,
      emailDigestEnabled,
      digestEmail,
      slackWebhookUrl,
    }),
    [scanEnabled, freqMode, customHours, scanFailureEnabled, emailDigestEnabled, digestEmail, slackWebhookUrl],
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
      setSlackTestError((e as Error).message);
      setTimeout(() => setSlackTestState("idle"), 4000);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 w-full items-center justify-center text-sm text-zinc-400">
        Loading settings…
      </div>
    );
  }

  const lastScan = formatWhen(data?.scan_status.last_scan_at ?? null);
  const nextScan = formatWhen(data?.scan_status.next_scan_at ?? null);
  const slackConnected = slackWebhookUrl.trim().length > 0;
  const accountEmail = data?.account_email ?? "";
  const deliveryPlaceholder = accountEmail || "you@company.com";

  return (
    <div className="w-full space-y-10 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Settings</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Scan automation, alerting, and reporting for your organization.
          </p>
        </div>
        <SaveIndicator status={saveStatus} error={saveError} />
      </div>

      <div className="grid gap-10 lg:grid-cols-2 lg:gap-x-14 lg:gap-y-0">
        {/* Left column — operations */}
        <div className="space-y-8">
          <div>
            <ColumnHeading title="Operations" description="Scan schedule and detection scope." />

            <div className={`${settingsCardClass} mb-6`}>
              <SettingRow title="Automated scans" description="Evidence timeline on a schedule." compact>
                <Toggle checked={scanEnabled} onChange={setScanEnabled} />
              </SettingRow>

              {scanEnabled && (
                <div className="border-t border-zinc-100 px-4 pb-4 pt-1">
                  <label htmlFor="scan-interval" className="mb-1.5 mt-3 block text-xs font-medium text-zinc-500">
                    Frequency
                  </label>
                  <select
                    id="scan-interval"
                    value={freqMode}
                    onChange={(e) => setFreqMode(e.target.value as FreqMode)}
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="daily" disabled={!canDaily}>
                      Daily{canDaily ? "" : " (paid plan)"}
                    </option>
                    <option value="weekly">Weekly</option>
                    <option value="custom">Custom interval</option>
                  </select>

                  {freqMode === "custom" && (
                    <div className="mt-2.5">
                      <label htmlFor="custom-hours" className="mb-1.5 block text-xs font-medium text-zinc-500">
                        Interval (hours)
                      </label>
                      <input
                        id="custom-hours"
                        type="number"
                        min={minCustomHours}
                        max={720}
                        step={1}
                        value={customHours}
                        onChange={(e) => setCustomHours(Number(e.target.value))}
                        className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                      <p className="mt-1 text-xs text-zinc-400">
                        {minCustomHours}–720 hours{minCustomHours >= 168 ? " (Free tier: 7+ days)" : ""}.
                      </p>
                    </div>
                  )}

                  <p className="mt-2 text-xs text-zinc-400">{scanScheduleLabel}</p>
                </div>
              )}

              <div className="border-t border-zinc-100 bg-zinc-50/60 px-4 py-2.5 text-xs text-zinc-500">
                {!data?.scan_status.account_connected ? (
                  <span>Connect an AWS account to enable automated scanning.</span>
                ) : (
                  <span>
                    {lastScan ? <>Last scan: {lastScan}</> : "No scan completed yet."}
                    {scanEnabled && nextScan && (
                      <>
                        {" · "}
                        Next: {nextScan}
                      </>
                    )}
                  </span>
                )}
              </div>
            </div>

            <Link
              to="/detection"
              className="group block overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm shadow-zinc-950/[0.04] ring-1 ring-indigo-500/[0.06] transition hover:border-indigo-200 hover:ring-indigo-500/10"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600 ring-1 ring-indigo-100">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
                    />
                  </svg>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600/80">Subsystem</span>
              </div>
              <h3 className="mt-3 text-sm font-bold text-zinc-900">Detection coverage</h3>
              <p className="mt-1 text-xs text-zinc-500">Benchmark checks and optional operational modules.</p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
                <span>
                  <span className="font-semibold tabular-nums text-zinc-900">{BENCHMARK_CHECK_COUNT}</span> benchmark
                  checks
                </span>
                <span>
                  <span className="font-semibold tabular-nums text-zinc-900">{optionalTotal}</span> optional modules
                </span>
                {enabledOptional > 0 && (
                  <span className="text-sky-700">{enabledOptional} active</span>
                )}
              </div>
              <p className="mt-3 text-sm font-semibold text-indigo-600 transition group-hover:text-indigo-800">
                Manage coverage →
              </p>
            </Link>
          </div>
        </div>

        {/* Right column — alerts & reporting */}
        <div className="space-y-8">
          <div>
            <ColumnHeading title="Alerts" description="Operational notifications when scans fail." />
            <div className={`${settingsCardClass} mb-6`}>
              <SettingRow
                title="Scan failure email"
                description="Notify when a scan fails or loses access."
                compact
              >
                <Toggle checked={scanFailureEnabled} onChange={setScanFailureEnabled} />
              </SettingRow>

              {scanFailureEnabled && (
                <div className="border-t border-zinc-100 px-4 pb-4">
                  <label htmlFor="alert-email" className="mb-1.5 mt-3 block text-xs font-medium text-zinc-500">
                    Delivery email
                  </label>
                  <input
                    id="alert-email"
                    type="email"
                    value={digestEmail}
                    onChange={(e) => setDigestEmail(e.target.value)}
                    placeholder={deliveryPlaceholder}
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              )}
            </div>
          </div>

          <div>
            <ColumnHeading title="Reporting" description="Scheduled findings summaries." />
            <div className={`${settingsCardClass} mb-6`}>
              <SettingRow title="Weekly email digest" description="Mondays at 9am UTC." compact>
                <Toggle checked={emailDigestEnabled} onChange={setEmailDigestEnabled} />
              </SettingRow>

              {emailDigestEnabled && (
                <div className="border-t border-zinc-100 px-4 pb-4">
                  {!scanFailureEnabled && (
                    <>
                      <label htmlFor="digest-email" className="mb-1.5 mt-3 block text-xs font-medium text-zinc-500">
                        Delivery email
                      </label>
                      <input
                        id="digest-email"
                        type="email"
                        value={digestEmail}
                        onChange={(e) => setDigestEmail(e.target.value)}
                        placeholder={deliveryPlaceholder}
                        className="mb-2 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </>
                  )}
                  {scanFailureEnabled && (
                    <p className="mt-3 text-xs text-zinc-500">Uses the delivery email from Alerts.</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div>
            <ColumnHeading title="Integrations" description="Channel delivery for reporting." />
            <div className={settingsCardClass}>
              <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#4A154B]/10 text-[#4A154B] ring-1 ring-[#4A154B]/15">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm8.694 0a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 22.57 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.52V8.834zm-1.27 0a2.527 2.527 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.758 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 8.694a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.758 24a2.528 2.528 0 0 1-2.523-2.522v-2.52h2.523z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-900">Slack</p>
                  <p className="text-xs text-zinc-500">Incoming webhook · weekly digest</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    slackConnected
                      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60"
                      : "bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200/80"
                  }`}
                >
                  {slackConnected ? "Connected" : "Not connected"}
                </span>
              </div>
              <div className="space-y-2 px-4 py-3">
                <label htmlFor="slack-webhook" className="block text-xs font-medium text-zinc-500">
                  Webhook URL
                </label>
                <input
                  id="slack-webhook"
                  type="url"
                  value={slackWebhookUrl}
                  onChange={(e) => setSlackWebhookUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/…"
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={sendSlackTest}
                    disabled={slackTestState === "sending" || !slackWebhookUrl.trim()}
                    className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {slackTestState === "sending" ? "Sending…" : "Send report"}
                  </button>
                  {slackTestState === "sent" && (
                    <span className="text-xs font-medium text-emerald-600">Delivered</span>
                  )}
                  {slackTestState === "error" && (
                    <span className="text-xs text-red-500">{slackTestError}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div>
            <ColumnHeading
              title="Evidence vault"
              description="Immutable archive target for evidence packs (operator-configured)."
            />
            <div className={`${settingsCardClass} mb-6`}>
              {vaultStatus.isLoading && (
                <p className="px-4 py-3 text-xs text-zinc-400">Loading vault status…</p>
              )}
              {vaultStatus.data && (
                <div className="space-y-2 px-4 py-3 text-xs text-zinc-600">
                  <p>
                    <span className="font-medium text-zinc-800">Status:</span>{" "}
                    {vaultStatus.data.enabled
                      ? "Enabled — packs include vault_upload_plan.json"
                      : vaultStatus.data.configured
                        ? "Configured but disabled (set EVIDENCE_VAULT_ENABLED=true)"
                        : "Not configured"}
                  </p>
                  {vaultStatus.data.s3_uri && (
                    <p className="font-mono text-[11px] text-zinc-700">{vaultStatus.data.s3_uri}</p>
                  )}
                  {vaultStatus.data.enabled && vaultStatus.data.retention_days != null && (
                    <p>
                      Object Lock: {vaultStatus.data.object_lock_mode} · {vaultStatus.data.retention_days} day
                      retention · auditor mode: {vaultStatus.data.auditor_access_mode}
                    </p>
                  )}
                  <p className="text-zinc-500">
                    Enable EVIDENCE_VAULT_ENABLED and point EVIDENCE_VAULT_S3_URI at your Object Lock bucket. See docs/evidence-vault.md.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Trust Center + Auditor Access */}
          <div className="lg:col-span-2 space-y-8">
            <TrustCenterSettings />
            <AuditorManagement />
          </div>

        </div>
      </div>
    </div>
  );
}
