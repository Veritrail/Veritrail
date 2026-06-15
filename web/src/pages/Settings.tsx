import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, formatApiError } from "../api";
import { CHECK_FRAMEWORK_MAP } from "../data/checkFrameworkMap";
import { PageCard, PageShell } from "../components/PageShell";
import { ProductShell } from "../components/ProductShell";
import { InfoTip, Toggle } from "../components/SettingsUi";
import { AuditorManagement } from "../components/AuditorManagement";
import { TeamMembersSettings } from "../components/TeamMembersSettings";
import { DomainsSettings } from "../components/DomainsSettings";
import { TrustCenterSettings } from "../components/TrustCenterSettings";
import { roleAtLeast, useMe } from "../hooks/useMe";
import "../styles/settings-cards.css";

type ScanInterval = "daily" | "weekly" | "custom" | "manual";
type FreqMode = "daily" | "weekly" | "custom";
type SaveStatus = "idle" | "saving" | "saved" | "error";
type SectionId = "scanning" | "notifications" | "detection" | "trust" | "access" | "domains" | "advanced";

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

function TextField({ id, label, value, onChange, placeholder, type = "text", monospace = false, readOnly = false }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; monospace?: boolean; readOnly?: boolean }) {
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
        readOnly={readOnly}
        className={`w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 shadow-inner shadow-zinc-950/[0.02] placeholder:text-zinc-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500/25 ${monospace ? "font-mono text-xs" : ""} ${readOnly ? "cursor-default opacity-80" : ""}`}
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
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-full border border-zinc-200 bg-zinc-100/70 p-1">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled || o.disabled}
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

const CARD_ICONS = {
  scanning: "M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  notifications:
    "M14.857 17.082a23.85 23.85 0 0 0 5.454-1.31A8.97 8.97 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.97 8.97 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.26 24.26 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0",
  detection:
    "M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15",
  trust:
    "M9 12.75 11.25 15 15 9.75m-3-7.036A11.96 11.96 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z",
  auditors:
    "M15 19.128a9.38 9.38 0 0 0 2.625.372 9.34 9.34 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.32 12.32 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z",
  team:
    "M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z",
  records:
    "M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z",
  advanced:
    "M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z",
  domains:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0a8.949 8.949 0 0 0 4.951-1.488A3.987 3.987 0 0 0 13 16.5a1.5 1.5 0 0 1-1.5-1.5v-1.5a.75.75 0 0 0-.75-.75 2.25 2.25 0 0 1-2.25-2.25c0-.414.336-.75.75-.75h1.5a.75.75 0 0 0 .75-.75v-.75a.75.75 0 0 1 .75-.75h.75a2.25 2.25 0 0 0 2.122-1.512M21 12c0-1.105-.2-2.163-.566-3.14",
} as const;

function CardIcon({ d }: { d: string }) {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

type IconTone = "blue" | "violet" | "green" | "amber" | "indigo" | "sky";
type BadgeTone = "on" | "info" | "off" | "warn";

function SettingsCard({
  icon,
  tone,
  title,
  subtitle,
  badge,
  badgeTone = "off",
  full,
  children,
}: {
  icon: string;
  tone: IconTone;
  title: string;
  subtitle: string;
  badge?: string;
  badgeTone?: BadgeTone;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`settings-card${full ? " settings-card--full" : ""}`}>
      <div className="settings-card__header">
        <span className={`settings-card__icon settings-card__icon--${tone}`}>
          <CardIcon d={icon} />
        </span>
        <span className="settings-card__titles">
          <span className="settings-card__title">{title}</span>
          <span className="settings-card__subtitle">{subtitle}</span>
        </span>
        {badge ? <span className={`settings-badge settings-badge--${badgeTone}`}>{badge}</span> : null}
      </div>
      <div className="settings-card__body">{children}</div>
    </section>
  );
}

const KPI_ACCENT: Record<string, string> = {
  green: "border-l-emerald-500",
  blue: "border-l-blue-500",
  violet: "border-l-violet-500",
  indigo: "border-l-indigo-500",
  amber: "border-l-amber-500",
  red: "border-l-red-500",
  slate: "border-l-zinc-300",
};

function KpiTile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: keyof typeof KPI_ACCENT }) {
  return (
    <div className={`rounded-xl border border-l-[3px] border-zinc-200 ${KPI_ACCENT[accent]} bg-white px-4 py-3.5 shadow-sm shadow-zinc-950/[0.02]`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-zinc-900">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{sub}</p>
    </div>
  );
}

type NavMeta = {
  id: SectionId;
  icon: string;
  tone: IconTone;
  title: string;
  navSub: string;
  detailSub: string;
  badge?: string;
  badgeTone: BadgeTone;
};

export default function Settings() {
  const qc = useQueryClient();
  const meQ = useMe();
  const canEditWorkspace = roleAtLeast(meQ.data?.role, "admin");
  const isOwner = meQ.data?.role === "owner";
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
    if (!canEditWorkspace) return;
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
  const [digestTestState, setDigestTestState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [digestTestMsg, setDigestTestMsg] = useState("");
  const [section, setSection] = useState<SectionId>("scanning");
  const [search, setSearch] = useState("");

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
    if (!hydrated || !canEditWorkspace) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const payload = buildPayload(formState);
      const json = JSON.stringify(payload);
      if (json === lastSavedJson.current) return;
      setSaveStatus("saving");
      mutation.mutate(payload);
    }, 600);
  }, [formState, hydrated, mutation, canEditWorkspace]);

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

  async function sendDigestTest() {
    setDigestTestState("sending");
    setDigestTestMsg("");
    try {
      const r = await api<{ sent_to: string }>("/v1/settings/test-digest", { method: "POST" });
      setDigestTestState("sent");
      setDigestTestMsg(`Sent to ${r.sent_to}`);
      setTimeout(() => setDigestTestState("idle"), 5000);
    } catch (e) {
      setDigestTestState("error");
      setDigestTestMsg(formatApiError(e));
      setTimeout(() => setDigestTestState("idle"), 6000);
    }
  }

  if (isLoading) return <div className="flex h-64 w-full items-center justify-center text-sm text-zinc-400">Loading settings…</div>;

  const lastScan = formatWhen(data?.scan_status.last_scan_at ?? null);
  const nextScan = formatWhen(data?.scan_status.next_scan_at ?? null);
  const slackConnected = slackWebhookUrl.trim().length > 0;
  const deliveryPlaceholder = data?.account_email ?? "you@company.com";

  const scanBadge = !scanEnabled ? "Manual" : freqMode === "custom" ? "Custom" : freqMode === "weekly" ? "Weekly" : "Daily";
  const alertsOn = scanFailureEnabled || criticalAlertEnabled || emailDigestEnabled;
  const activeAuditors = (auditorList.data ?? []).filter(
    (a) => a.is_active && new Date(a.expires_at) > new Date(),
  ).length;

  // ── Section nav meta ─────────────────────────────────────
  const navItems: NavMeta[] = [
    { id: "scanning", icon: CARD_ICONS.scanning, tone: "blue", title: "Scanning", navSub: "Cadence and scan window", detailSub: "Set scan cadence and automate evidence collection.", badge: scanBadge, badgeTone: "info" },
    { id: "notifications", icon: CARD_ICONS.notifications, tone: "violet", title: "Notifications", navSub: "Digest and alert emails", detailSub: "Manage alerts, digest, and delivery channels.", badge: alertsOn ? "On" : "Off", badgeTone: alertsOn ? "on" : "off" },
    { id: "detection", icon: CARD_ICONS.detection, tone: "sky", title: "Detection scope", navSub: "Optional modules", detailSub: "Control what counts toward the compliance score.", badge: `${enabledOptional} / ${optionalTotal}`, badgeTone: "info" },
    { id: "trust", icon: CARD_ICONS.trust, tone: "green", title: "Trust Center", navSub: "Public security profile", detailSub: "Public security profile, not a live compliance scorecard.", badge: trustCenter.data?.is_enabled ? "Live" : "Off", badgeTone: trustCenter.data?.is_enabled ? "on" : "off" },
    { id: "access", icon: CARD_ICONS.auditors, tone: "indigo", title: "Access", navSub: "Auditors and members", detailSub: "Invite external auditors and manage workspace roles.", badge: activeAuditors ? `${activeAuditors} active` : "None", badgeTone: activeAuditors ? "on" : "off" },
    ...(canEditWorkspace
      ? ([{ id: "domains", icon: CARD_ICONS.domains, tone: "sky", title: "Domains", navSub: "DNS verification", detailSub: "Verify a company domain via DNS, then optionally let new signups auto-join.", badgeTone: "off" }] as NavMeta[])
      : []),
    { id: "advanced", icon: CARD_ICONS.advanced, tone: "violet", title: "Advanced", navSub: "Experimental controls", detailSub: "Optional and experimental features. No compliance-score impact.", badge: aiFindingReviewEnabled ? "On" : "Off", badgeTone: aiFindingReviewEnabled ? "on" : "off" },
  ];
  const q = search.trim().toLowerCase();
  const visibleNav = q ? navItems.filter((n) => n.title.toLowerCase().includes(q) || n.navSub.toLowerCase().includes(q) || n.detailSub.toLowerCase().includes(q)) : navItems;
  const activeMeta = navItems.find((n) => n.id === section) ?? navItems[0];
  const detailCompact = section === "notifications";

  return (
    <ProductShell>
      <PageShell
        variant="compact"
        eyebrow="Workspace controls"
        title="Settings"
        actions={canEditWorkspace ? <SaveIndicator status={saveStatus} error={saveError} /> : undefined}
        width="w-full"
      >
        <div className="settings2">
          {!canEditWorkspace && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              View-only — workspace settings can be changed by admins and owners.
            </p>
          )}

          {/* KPI strip — Accounts-style colored-left-border tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiTile label="Scanning" value={scanBadge} sub={scanEnabled ? "Automated scans on" : "Manual only"} accent={scanEnabled ? "blue" : "slate"} />
            <KpiTile label="Notifications" value={alertsOn ? "On" : "Off"} sub="Digest & alert emails" accent={alertsOn ? "violet" : "slate"} />
            <KpiTile label="Auditors" value={String(activeAuditors)} sub={activeAuditors ? "Active external access" : "No external access"} accent={activeAuditors ? "indigo" : "slate"} />
            <KpiTile label="Optional checks" value={`${enabledOptional} / ${optionalTotal}`} sub={enabledOptional ? `${enabledOptional} scored` : "None scored"} accent={enabledOptional ? "amber" : "slate"} />
          </div>

          {/* Stacked section cards */}
          <div>
            <SettingsCard icon={CARD_ICONS.scanning} tone="blue" title="Scanning" subtitle="Set scan cadence and automate evidence collection." badge={scanBadge} badgeTone="info">
                {(
                  <div className="space-y-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900">Automated scans</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">Collect evidence and refresh findings on a schedule.</p>
                      </div>
                      <Toggle checked={scanEnabled} onChange={setScanEnabled} disabled={!canEditWorkspace} />
                    </div>
                    {scanEnabled && (
                      <div className="rounded-xl border border-zinc-100 bg-zinc-50/60 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-zinc-900">Frequency</p>
                            <p className="mt-0.5 text-xs text-zinc-500">Changes apply after the next completed scan.</p>
                          </div>
                          <Segmented
                            value={freqMode}
                            onChange={(v) => setFreqMode(v as FreqMode)}
                            disabled={!canEditWorkspace}
                            options={[
                              { value: "daily", label: canDaily ? "Daily" : "Daily · paid", disabled: !canDaily },
                              { value: "weekly", label: "Weekly" },
                              { value: "custom", label: "Custom" },
                            ]}
                          />
                        </div>
                        {freqMode === "custom" && (
                          <div className="mt-3 flex items-center gap-2">
                            <input
                              type="number"
                              min={minCustomHours}
                              max={720}
                              step={1}
                              value={customHours}
                              onChange={(e) => setCustomHours(Number(e.target.value))}
                              readOnly={!canEditWorkspace}
                              className="w-24 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500/25 disabled:opacity-70"
                            />
                            <span className="text-xs text-zinc-500">hours ({minCustomHours}–720)</span>
                          </div>
                        )}
                      </div>
                    )}
                    {!data?.scan_status.account_connected ? (
                      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-800">
                        Connect an AWS account to enable scheduled scans.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Last scan</p>
                          <p className="mt-1 text-sm font-semibold leading-snug text-zinc-900">{lastScan ?? "No scan yet"}</p>
                        </div>
                        <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Next scan</p>
                          <p className="mt-1 text-sm font-semibold leading-snug text-zinc-900">{scanEnabled ? nextScan ?? "—" : "Manual only"}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
            </SettingsCard>

            <SettingsCard icon={CARD_ICONS.notifications} tone="violet" title="Notifications" subtitle="Manage alerts, digest, and delivery channels." badge={alertsOn ? "On" : "Off"} badgeTone={alertsOn ? "on" : "off"}>
              {(
                <div className="-my-1">
                    <div className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900">Scan failure email</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">Notify when a scan fails or loses AWS access.</p>
                      </div>
                      <Toggle checked={scanFailureEnabled} onChange={setScanFailureEnabled} disabled={!canEditWorkspace} />
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-zinc-100 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900">Critical finding alerts</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">Notify immediately by email on new critical or high findings.</p>
                      </div>
                      <Toggle checked={criticalAlertEnabled} onChange={setCriticalAlertEnabled} disabled={!canEditWorkspace} />
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-zinc-100 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900">Weekly email digest</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">Findings summary every Monday at 9:00 UTC.</p>
                      </div>
                      <Toggle checked={emailDigestEnabled} onChange={setEmailDigestEnabled} disabled={!canEditWorkspace} />
                    </div>
                    {alertsOn && (
                      <div className="border-t border-zinc-100 pt-4">
                        <div>
                          <p className="text-sm font-semibold text-zinc-900">Delivery email</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">Where operational security emails are sent.</p>
                          <input
                            id="delivery-email"
                            type="email"
                            value={digestEmail}
                            onChange={(e) => setDigestEmail(e.target.value)}
                            placeholder={deliveryPlaceholder}
                            readOnly={!canEditWorkspace}
                            className="mt-3 w-full min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
                          />
                        </div>
                      </div>
                    )}
                    {emailDigestEnabled && (
                      <div className="border-t border-zinc-100 pt-4 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={sendDigestTest}
                          disabled={!canEditWorkspace || digestTestState === "sending"}
                          className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                        >
                          {digestTestState === "sending" ? "Sending…" : "Send test digest"}
                        </button>
                        <span className="text-xs text-zinc-400">Sends this week's digest now to the delivery email.</span>
                        {digestTestMsg && (
                          <span className={`text-xs font-medium ${digestTestState === "error" ? "text-red-600" : "text-emerald-600"}`}>{digestTestMsg}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
            </SettingsCard>

            <SettingsCard icon={CARD_ICONS.detection} tone="sky" title="Detection scope" subtitle="Control what counts toward the compliance score." badge={`${enabledOptional} / ${optionalTotal}`} badgeTone="info">
              {(
                <div>
                    <p className="mb-4 text-xs leading-relaxed text-zinc-600">
                      <strong className="font-semibold text-zinc-900">{BENCHMARK_CHECK_COUNT}</strong> benchmark checks · always on. Optional modules are not scored unless enabled; changes apply after the next scan.
                    </p>
                    <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
                      {(data?.optional_checks ?? []).map((check) => {
                        const enabled = optionalChecks[check.check_id] ?? check.default_enabled;
                        return (
                          <div key={check.check_id} className={`rounded-xl border p-3.5 transition ${enabled ? "border-sky-200/70 bg-white ring-1 ring-sky-500/5" : "border-dashed border-zinc-200/90 bg-white hover:border-zinc-300/90"}`}>
                            <div className="flex items-center justify-between gap-3">
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${enabled ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200/60" : "bg-zinc-50 text-zinc-600 ring-1 ring-zinc-200/70"}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-sky-500" : "bg-zinc-300"}`} aria-hidden />
                                {enabled ? "On" : "Off"}
                              </span>
                              <Toggle checked={enabled} onChange={() => toggleOptionalCheck(check.check_id)} disabled={!canEditWorkspace} />
                            </div>
                            <div className="mt-2 flex items-start gap-1.5">
                              <h3 className="text-sm font-semibold text-zinc-900">{check.label}</h3>
                              <InfoTip text={check.description} />
                            </div>
                            <p className="mt-0.5 text-xs leading-snug text-zinc-600">{check.summary}</p>
                          </div>
                        );
                      })}
                    </div>
                    {(data?.optional_checks ?? []).length === 0 && (
                      <p className="py-6 text-center text-sm text-zinc-400">No optional capabilities available.</p>
                    )}
                  </div>
                )}
            </SettingsCard>

            <SettingsCard icon={CARD_ICONS.trust} tone="green" title="Trust Center" subtitle="Public security profile, not a live compliance scorecard." badge={trustCenter.data?.is_enabled ? "Live" : "Off"} badgeTone={trustCenter.data?.is_enabled ? "on" : "off"}>
              {canEditWorkspace ? <TrustCenterSettings /> : <p className="text-sm text-zinc-500">Admins and owners can manage the Trust Center.</p>}
            </SettingsCard>

            <SettingsCard icon={CARD_ICONS.auditors} tone="indigo" title="Access" subtitle="Invite external auditors and manage workspace roles." badge={activeAuditors ? `${activeAuditors} active` : "None"} badgeTone={activeAuditors ? "on" : "off"}>
              {canEditWorkspace ? (
                <div className="space-y-4">
                  <AuditorManagement />
                  {isOwner && <TeamMembersSettings />}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Admins and owners can manage access.</p>
              )}
            </SettingsCard>

            {canEditWorkspace && (
              <SettingsCard icon={CARD_ICONS.domains} tone="sky" title="Domains" subtitle="Verify a company domain via DNS, then optionally let new signups auto-join.">
                <DomainsSettings />
              </SettingsCard>
            )}

            <SettingsCard icon={CARD_ICONS.advanced} tone="violet" title="Advanced" subtitle="Optional and experimental features. No compliance-score impact." badge={aiFindingReviewEnabled ? "On" : "Off"} badgeTone={aiFindingReviewEnabled ? "on" : "off"}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900">AI finding review</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">Advisory summaries in finding drawers when an LLM is configured.</p>
                </div>
                <Toggle checked={aiFindingReviewEnabled} onChange={setAiFindingReviewEnabled} disabled={!canEditWorkspace} />
              </div>
            </SettingsCard>
          </div>
        </div>
      </PageShell>
    </ProductShell>
  );
}
