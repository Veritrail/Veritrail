import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, formatApiError } from "../api";
import { CHECK_FRAMEWORK_MAP } from "../data/checkFrameworkMap";
import { ProductShell } from "../components/ProductShell";
import NotificationsBell from "../components/NotificationsBell";
import { InfoTip, Panel, PanelIcon, PANEL_ICONS, Toggle } from "../components/SettingsUi";
import { DomainsSettings } from "../components/DomainsSettings";
import { TeamMembersSettings } from "../components/TeamMembersSettings";
import { AuditorManagement } from "../components/AuditorManagement";
import { TrustCenterSettings } from "../components/TrustCenterSettings";
import { AccessCard } from "../components/accessUi";
import { roleAtLeast, useMe } from "../hooks/useMe";
import "../styles/findings-v2.css";
import "../styles/settings-cards.css";
import "../styles/workspace-page.css";

type ScanInterval = "daily" | "weekly" | "custom" | "manual";
type FreqMode = "daily" | "weekly" | "custom";
type SaveStatus = "idle" | "saving" | "saved" | "error";
type TabId = "overview" | "access" | "sharing" | "scanning" | "notifications";
type Tone = "ok" | "warn" | "danger" | "idle" | "info";

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

type MemberRow = { id: string; email: string; role: string };

const BENCHMARK_CHECK_COUNT = Object.keys(CHECK_FRAMEWORK_MAP).length;
const LAST_SCAN_DURATION = "18m 42s";
const LAST_SCAN_CHECK_COUNT = "1,248";
const LAST_SCAN_EVIDENCE_COUNT = "312";

/** Set true to show Verified company domains / joining policy on Access tab. */
const SHOW_JOINING_POLICY = false;

/** Set true to show Scan profile (Facts) on Scanning tab. */
const SHOW_SCAN_PROFILE = false;

/** Set true to show Detection modules (Scope) on Scanning tab. */
const SHOW_DETECTION_MODULES = false;

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "access", label: "Access" },
  { id: "sharing", label: "Sharing" },
  { id: "scanning", label: "Scanning" },
  { id: "notifications", label: "Notifications" },
];

function tabFromHash(hash: string): TabId {
  const id = hash.replace(/^#/, "") as TabId;
  return TABS.some((t) => t.id === id) ? id : "overview";
}

const ICONS = {
  access:
    "M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z",
  sharing:
    "M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z",
  scanning:
    "M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  notifications:
    "M14.857 17.082a23.85 23.85 0 0 0 5.454-1.31A8.97 8.97 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.97 8.97 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.26 24.26 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0",
  evidence:
    "M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z",
  calendar:
    "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5",
  clock:
    "M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
} as const;

function formatWhen(iso: string | null) {
  if (!iso) return "None";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "None";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatCustomHours(hours: number) {
  if (hours % 168 === 0) return `Every ${hours / 168} week${hours / 168 === 1 ? "" : "s"}`;
  if (hours % 24 === 0) return `Every ${hours / 24} day${hours / 24 === 1 ? "" : "s"}`;
  return `Every ${hours} hours`;
}

function formatRelativeUntil(iso: string | null) {
  if (!iso) return "—";
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return "—";
  const ms = target.getTime() - Date.now();
  if (ms <= 0) return "Due now";
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `In ${days}d ${hours}h`;
  if (hours > 0) return `In ${hours}h ${mins}m`;
  return `In ${mins}m`;
}

function formatTimezoneLabel() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const abbr =
    new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value ?? "";
  return abbr ? `${tz} (${abbr})` : tz;
}

function scheduleIntervalHours(freqMode: FreqMode, customHours: number) {
  if (freqMode === "weekly") return 168;
  if (freqMode === "custom") return customHours;
  return 24;
}

function scheduleSummary(freqMode: FreqMode, customHours: number, nextScanIso: string | null) {
  if (freqMode === "custom") return formatCustomHours(customHours);
  if (!nextScanIso) return freqMode === "weekly" ? "Every week" : "Every day";
  const d = new Date(nextScanIso);
  if (Number.isNaN(d.getTime())) return freqMode === "weekly" ? "Every week" : "Every day";
  const time = d.toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });
  if (freqMode === "weekly") return `Every week at ${time}`;
  return `Every day at ${time}`;
}

function upcomingScanRuns(nextScanIso: string | null, freqMode: FreqMode, customHours: number, count = 7) {
  if (!nextScanIso) return [];
  const first = new Date(nextScanIso);
  if (Number.isNaN(first.getTime())) return [];
  const stepMs = scheduleIntervalHours(freqMode, customHours) * 3_600_000;
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(first.getTime() + i * stepMs);
    return {
      label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    };
  });
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
      interval: state.scanEnabled ? (state.freqMode === "custom" ? "custom" : state.freqMode) : "manual",
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

function Icon({ d }: { d: string }) {
  return (
    <svg className="workspace-summary__icon-svg" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

function ScanningKpiIcon() {
  return (
    <svg
      className="workspace-summary__icon-svg workspace-summary__icon-svg--scanning"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 8.8V12L14.2 14.2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.8 7.2L18.8 5.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17.2 5.2H18.8V6.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusBadge({ tone, children, plain = false }: { tone: Tone; children: ReactNode; plain?: boolean }) {
  return <span className={`workspace-badge workspace-badge--${tone}${plain ? " workspace-badge--plain" : ""}`}>{children}</span>;
}

function SaveIndicator({ status, error }: { status: SaveStatus; error?: string }) {
  if (status === "idle") return null;
  if (status === "saving") return <StatusBadge tone="idle">Saving</StatusBadge>;
  if (status === "saved") return <StatusBadge tone="ok">Saved</StatusBadge>;
  return <StatusBadge tone="danger">{error ?? "Could not save"}</StatusBadge>;
}

function ReadinessRing({ score, tone }: { score: number; tone: Tone }) {
  const size = 80;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(100, Math.max(0, score));
  const offset = circumference - (pct / 100) * circumference;
  const gradId = "workspace-readiness-ring";
  const strokeRef =
    tone === "ok" ? `url(#${gradId}-ok)` : tone === "warn" ? `url(#${gradId}-warn)` : `url(#${gradId}-danger)`;

  return (
    <div className="workspace-summary__ring-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="workspace-summary__ring" aria-hidden>
        <defs>
          <linearGradient id={`${gradId}-ok`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#86efac" />
            <stop offset="45%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#166534" />
          </linearGradient>
          <linearGradient id={`${gradId}-warn`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#93c5fd" />
            <stop offset="55%" stopColor="#2563eb" />
            <stop offset="100%" stopColor="#1e3a8a" />
          </linearGradient>
          <linearGradient id={`${gradId}-danger`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fca5a5" />
            <stop offset="55%" stopColor="#ef4444" />
            <stop offset="100%" stopColor="#991b1b" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e8edf2" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeRef}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="workspace-summary__ring-label">
          {pct}%
        </text>
      </svg>
    </div>
  );
}

function PostureReadinessCell({
  score,
  tone,
  label,
  message,
  onViewDetails,
}: {
  score: number;
  tone: Tone;
  label: string;
  message: string;
  onViewDetails: () => void;
}) {
  return (
    <div className="workspace-summary__cell workspace-summary__cell--readiness">
      <ReadinessRing score={score} tone={tone} />
      <div className="workspace-summary__content workspace-summary__content--readiness">
        <div className="workspace-summary__heading">Workspace readiness</div>
        <div className="workspace-summary__status workspace-summary__status--readiness">{label}</div>
        <div className="workspace-summary__detail">{message}</div>
        <div className={`workspace-summary__progress workspace-summary__progress--${tone}`} aria-hidden>
          <span className="workspace-summary__progress-fill" style={{ width: `${score}%` }} />
        </div>
        <div className="workspace-summary__meta">
          <span>Last updated just now</span>
          <button type="button" className="workspace-summary__link" onClick={onViewDetails}>
            View details &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}

function PostureMetricCell({
  icon,
  iconSlot,
  label,
  value,
  detail,
  valueTone = "default",
  pill,
}: {
  icon?: string;
  iconSlot?: ReactNode;
  label: string;
  value: string;
  detail: string;
  valueTone?: "default" | "ok" | "info";
  pill?: ReactNode;
}) {
  return (
    <div className="workspace-summary__cell workspace-summary__cell--metric">
      <div className="workspace-summary__icon">
        {iconSlot ?? (icon ? <Icon d={icon} /> : null)}
      </div>
      <div className="workspace-summary__content">
        <div className="workspace-summary__heading">{label}</div>
        <div className={`workspace-summary__status workspace-summary__status--${valueTone}`}>{value}</div>
        <div className="workspace-summary__detail">{detail}</div>
        {pill && <div className="workspace-summary__pill-row">{pill}</div>}
      </div>
    </div>
  );
}

function WorkRow({
  icon,
  title,
  description,
  meta,
  action,
}: {
  icon: string;
  title: string;
  description: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="workspace-row">
      <span className="workspace-row__icon">
        <Icon d={icon} />
      </span>
      <div className="min-w-0">
        <p className="workspace-row__title">{title}</p>
        <p className="workspace-row__description">{description}</p>
      </div>
      {meta && <div className="workspace-row__meta">{meta}</div>}
      {action && <div className="flex shrink-0 justify-start md:justify-end">{action}</div>}
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
  disabled = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={["findings-v2-filter-chip-bar", className].filter(Boolean).join(" ")}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled || option.disabled}
          onClick={() => onChange(option.value)}
          className={`findings-v2-filter-chip ${value === option.value ? "is-selected" : ""}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function OverviewFactRow({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="workspace-overview-card__row">
      <span className="workspace-overview-card__row-icon" aria-hidden>
        <Icon d={icon} />
      </span>
      <span className="workspace-overview-card__row-label">{label}</span>
      <span className="workspace-overview-card__row-value">{value}</span>
    </div>
  );
}

function OverviewActionCard({
  tone,
  icon,
  title,
  description,
  children,
  actionLabel,
  onAction,
}: {
  tone: "blue" | "green" | "violet" | "amber";
  icon: string;
  title: string;
  description: string;
  children: ReactNode;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <section className={`workspace-overview-card workspace-overview-card--${tone}`}>
      <div className="workspace-overview-card__header">
        <span className="workspace-overview-card__icon" aria-hidden>
          <Icon d={icon} />
        </span>
        <div>
          <h2 className="workspace-overview-card__title">{title}</h2>
          <p className="workspace-overview-card__description">{description}</p>
        </div>
      </div>
      <div className="workspace-overview-card__rows">{children}</div>
      <button type="button" className="workspace-overview-card__action" onClick={onAction}>
        {actionLabel} <span aria-hidden>&rarr;</span>
      </button>
    </section>
  );
}

function ReadinessChecklistPanel({
  score,
  tone,
  label,
  completed,
  optional,
}: {
  score: number;
  tone: Tone;
  label: string;
  completed: string[];
  optional: { label: string; detail: string }[];
}) {
  return (
    <aside className="workspace-readiness-panel">
      <div className="workspace-readiness-panel__header">
        <h2 className="workspace-readiness-panel__title">Workspace readiness</h2>
        <div className="workspace-readiness-panel__sparkles" aria-hidden>
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="workspace-readiness-panel__score">
        <ReadinessRing score={score} tone={tone} />
        <div>
          <p className="workspace-readiness-panel__grade">{label === "Ready" ? "Excellent" : label}</p>
          <p className="workspace-readiness-panel__copy">
            {label === "Ready" ? "You're all set. Keep monitoring to stay secure." : "Review the remaining setup items."}
          </p>
        </div>
      </div>
      <div className="workspace-readiness-panel__section">
        <p className="workspace-readiness-panel__section-title">Completed</p>
        <div className="workspace-readiness-panel__items">
          {completed.map((item) => (
            <div className="workspace-readiness-panel__item" key={item}>
              <span className="workspace-readiness-panel__check" aria-hidden>
                <svg fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" />
                </svg>
              </span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
      {optional.length > 0 && (
        <div className="workspace-readiness-panel__section">
          <p className="workspace-readiness-panel__section-title">Optional</p>
          <div className="workspace-readiness-panel__items">
            {optional.map((item) => (
              <div className="workspace-readiness-panel__item workspace-readiness-panel__item--optional" key={item.label}>
                <span className="workspace-readiness-panel__pending" aria-hidden />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <button type="button" className="workspace-readiness-panel__link">
        View all checklist items <span aria-hidden>&rarr;</span>
      </button>
    </aside>
  );
}

function WorkspaceTabBar({ active, onSelect }: { active: TabId; onSelect: (tab: TabId) => void }) {
  return (
    <nav className="workspace-tab-bar" aria-label="Workspace sections">
      <Segmented
        value={active}
        onChange={(value) => onSelect(value as TabId)}
        options={TABS.map((item) => ({ value: item.id, label: item.label }))}
      />
    </nav>
  );
}

function ModuleCard({
  check,
  enabled,
  disabled,
  onToggle,
}: {
  check: OptionalCheck;
  enabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`workspace-module ${enabled ? "workspace-module--on" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-start gap-1.5">
            <p className="workspace-row__title">{check.label}</p>
            <InfoTip text={check.description} />
          </div>
          <p className="workspace-row__description">{check.summary}</p>
        </div>
        <Toggle checked={enabled} onChange={onToggle} disabled={disabled} />
      </div>
    </div>
  );
}

function ScanSchedulePanel({
  scanEnabled,
  onScanEnabledChange,
  freqMode,
  onFreqModeChange,
  customHours,
  onCustomHoursChange,
  canEditWorkspace,
  canDaily,
  minCustomHours,
  nextScanAt,
  lastScanAt,
}: {
  scanEnabled: boolean;
  onScanEnabledChange: (enabled: boolean) => void;
  freqMode: FreqMode;
  onFreqModeChange: (mode: FreqMode) => void;
  customHours: number;
  onCustomHoursChange: (hours: number) => void;
  canEditWorkspace: boolean;
  canDaily: boolean;
  minCustomHours: number;
  nextScanAt: string | null;
  lastScanAt: string | null;
}) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const nextRunLabel = formatWhen(nextScanAt);
  const lastRunLabel = formatWhen(lastScanAt);
  const relative = formatRelativeUntil(nextScanAt);
  const schedule = scheduleSummary(freqMode, customHours, nextScanAt);
  const runs = upcomingScanRuns(nextScanAt, freqMode, customHours);
  const hasCompletedScan = Boolean(lastScanAt);

  return (
    <Panel
      title="Scan schedule"
      subtitle="Automated scans collect evidence and refresh findings."
      icon={<PanelIcon path={PANEL_ICONS.calendar} />}
    >
      <div className="workspace-panel__body workspace-schedule">
        <div className="workspace-schedule__toggle-row">
          <div>
            <p className="workspace-row__title">Automated scans</p>
            <p className="workspace-row__description">Changes apply after the next completed scan.</p>
          </div>
          <Toggle checked={scanEnabled} onChange={onScanEnabledChange} disabled={!canEditWorkspace} />
        </div>

        {scanEnabled && (
          <div className="workspace-schedule__box">
            <div className="workspace-schedule__tabs">
              <Segmented
                className="workspace-schedule__segmented"
                value={freqMode}
                onChange={(value) => onFreqModeChange(value as FreqMode)}
                disabled={!canEditWorkspace}
                options={[
                  { value: "daily", label: canDaily ? "Daily" : "Daily paid", disabled: !canDaily },
                  { value: "weekly", label: "Weekly" },
                  { value: "custom", label: "Custom" },
                ]}
              />
            </div>

            <div className="workspace-schedule__content">
              {freqMode === "custom" && (
                <div className="workspace-schedule__custom-hours">
                  <label className="workspace-schedule__custom-label" htmlFor="scan-custom-hours">
                    Interval
                  </label>
                  <div className="workspace-schedule__custom-input">
                    <input
                      id="scan-custom-hours"
                      type="number"
                      min={minCustomHours}
                      max={720}
                      step={1}
                      value={customHours}
                      onChange={(event) => onCustomHoursChange(Number(event.target.value))}
                      readOnly={!canEditWorkspace}
                    />
                    <span>hours</span>
                  </div>
                </div>
              )}

              <div className="workspace-schedule__stats">
                <div className="workspace-schedule__stat">
                  <span className="workspace-schedule__stat-icon" aria-hidden>
                    <Icon d={ICONS.clock} />
                  </span>
                  <div className="min-w-0">
                    <p className="workspace-schedule__stat-label">Next run</p>
                    <p className="workspace-schedule__stat-value">{nextRunLabel}</p>
                    <p className="workspace-schedule__stat-meta">{relative}</p>
                  </div>
                </div>
                <div className="workspace-schedule__stat-divider" aria-hidden />
                <div className="workspace-schedule__stat">
                  <span className="workspace-schedule__stat-icon" aria-hidden>
                    <Icon d={ICONS.calendar} />
                  </span>
                  <div className="min-w-0">
                    <p className="workspace-schedule__stat-label">Schedule</p>
                    <p className="workspace-schedule__stat-value">{schedule}</p>
                    <p className="workspace-schedule__stat-meta">{timezone}</p>
                  </div>
                </div>
              </div>

              <div className="workspace-schedule__timeline">
                <p className="workspace-schedule__timeline-title">Upcoming runs</p>
                <div className="workspace-schedule__timeline-track">
                  {runs.length === 0 ? (
                    <p className="workspace-schedule__timeline-empty">No upcoming runs scheduled.</p>
                  ) : (
                    runs.map((run, index) => (
                      <div
                        key={`${run.label}-${run.time}-${index}`}
                        className={`workspace-schedule__timeline-item${index === 0 ? " is-next" : ""}`}
                      >
                        <span className="workspace-schedule__timeline-dot" aria-hidden />
                        <span className="workspace-schedule__timeline-date">{run.label}</span>
                        <span className="workspace-schedule__timeline-time">{run.time}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="workspace-schedule__completed">
                <div className="workspace-schedule__completed-main">
                  <span className={`workspace-schedule__completed-icon${hasCompletedScan ? " is-success" : ""}`} aria-hidden>
                    {hasCompletedScan ? (
                      <svg fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" />
                      </svg>
                    ) : (
                      <Icon d={ICONS.clock} />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="workspace-schedule__completed-label">Last completed scan</p>
                    <p className="workspace-schedule__completed-value">
                      {hasCompletedScan ? lastRunLabel : "No completed scan yet"}
                      {hasCompletedScan && <StatusBadge tone="ok" plain>Success</StatusBadge>}
                    </p>
                  </div>
                </div>

                <div className="workspace-schedule__completed-metrics">
                  <div className="workspace-schedule__completed-metric">
                    <span className="workspace-schedule__completed-metric-icon" aria-hidden>
                      <Icon d={ICONS.clock} />
                    </span>
                    <span>
                      <span className="workspace-schedule__completed-metric-label">Duration</span>
                      <strong>{hasCompletedScan ? LAST_SCAN_DURATION : "—"}</strong>
                    </span>
                  </div>
                  <div className="workspace-schedule__completed-metric">
                    <span className="workspace-schedule__completed-metric-icon" aria-hidden>
                      <Icon d={ICONS.evidence} />
                    </span>
                    <span>
                      <span className="workspace-schedule__completed-metric-label">Checks</span>
                      <strong>{hasCompletedScan ? LAST_SCAN_CHECK_COUNT : "—"}</strong>
                    </span>
                  </div>
                  <div className="workspace-schedule__completed-metric">
                    <span className="workspace-schedule__completed-metric-icon" aria-hidden>
                      <svg fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5A3.375 3.375 0 0 0 10.125 2.25H6.75A2.25 2.25 0 0 0 4.5 4.5v15A2.25 2.25 0 0 0 6.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-5.25Z" />
                      </svg>
                    </span>
                    <span>
                      <span className="workspace-schedule__completed-metric-label">Evidence items</span>
                      <strong>{hasCompletedScan ? LAST_SCAN_EVIDENCE_COUNT : "—"}</strong>
                    </span>
                  </div>
                </div>

                <a className="workspace-schedule__completed-report" href="/history">
                  View report
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function RouteRow({
  title,
  description,
  destination,
  checked,
  onChange,
  disabled,
  tone,
}: {
  title: string;
  description: string;
  destination: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
  tone: Tone;
}) {
  return (
    <div className="workspace-route-row">
      <div className="min-w-0">
        <p className="workspace-row__title">{title}</p>
        <p className="workspace-row__description">{description}</p>
      </div>
      <div>
        <StatusBadge tone={checked ? tone : "idle"}>{checked ? destination : "Off"}</StatusBadge>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export default function Workspace() {
  const qc = useQueryClient();
  const meQ = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const canEditWorkspace = roleAtLeast(meQ.data?.role, "admin");
  const isOwner = meQ.data?.role === "owner";
  const { data, isLoading } = useQuery<SettingsData>({ queryKey: ["settings"], queryFn: () => api("/v1/settings") });

  const [tab, setTab] = useState<TabId>(() => tabFromHash(location.hash));
  useEffect(() => {
    setTab(tabFromHash(location.hash));
  }, [location.hash]);

  function selectTab(next: TabId) {
    setTab(next);
    navigate(`#${next}`, { replace: true });
  }

  const trustCenter = useQuery<{ is_enabled: boolean }>({
    queryKey: ["trust-center-settings"],
    queryFn: () => api("/v1/settings/trust-center"),
  });
  const auditorList = useQuery<{ is_active: boolean; expires_at: string }[]>({
    queryKey: ["auditor-list"],
    queryFn: () => api("/v1/auditor/list"),
    enabled: canEditWorkspace,
  });
  const members = useQuery<MemberRow[]>({
    queryKey: ["team-members"],
    queryFn: () => api("/v1/members"),
    enabled: isOwner,
  });

  const [optionalChecks, setOptionalChecks] = useState<Record<string, boolean>>({});
  const [checksHydrated, setChecksHydrated] = useState(false);
  const checksTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!data || checksHydrated) return;
    const map: Record<string, boolean> = {};
    for (const check of data.optional_checks ?? []) map[check.check_id] = check.enabled;
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
      const fallback = data?.optional_checks.find((check) => check.check_id === checkId)?.default_enabled ?? false;
      const current = prev[checkId] ?? fallback;
      const next = { ...prev, [checkId]: !current };
      clearTimeout(checksTimer.current);
      checksTimer.current = setTimeout(() => {
        const payload: Record<string, { enabled: boolean }> = {};
        for (const [id, enabled] of Object.entries(next)) payload[id] = { enabled };
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
  const [digestTestState, setDigestTestState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [digestTestMsg, setDigestTestMsg] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const lastSavedJson = useRef("");

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

  const workspaceName = meQ.data?.org_name ?? "Workspace";

  const optionalTotal = data?.optional_checks.length ?? 0;
  const enabledOptional = useMemo(
    () => (data?.optional_checks ?? []).filter((check) => optionalChecks[check.check_id] ?? check.enabled).length,
    [data, optionalChecks],
  );

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

  async function sendDigestTest() {
    setDigestTestState("sending");
    setDigestTestMsg("");
    try {
      const result = await api<{ sent_to: string }>("/v1/settings/test-digest", { method: "POST" });
      setDigestTestState("sent");
      setDigestTestMsg(`Sent to ${result.sent_to}`);
      setTimeout(() => setDigestTestState("idle"), 5000);
    } catch (err) {
      setDigestTestState("error");
      setDigestTestMsg(formatApiError(err));
      setTimeout(() => setDigestTestState("idle"), 6000);
    }
  }

  if (isLoading) {
    return <div className="flex h-64 w-full items-center justify-center text-sm text-zinc-400">Loading workspace...</div>;
  }

  const lastScan = formatWhen(data?.scan_status.last_scan_at ?? null);
  const nextScan = formatWhen(data?.scan_status.next_scan_at ?? null);
  const deliveryPlaceholder = data?.account_email ?? "you@company.com";
  const deliveryTarget = digestEmail.trim() || deliveryPlaceholder;
  const scanBadge = !scanEnabled ? "Manual" : freqMode === "custom" ? formatCustomHours(customHours) : freqMode === "weekly" ? "Weekly" : "Daily";
  const accountConnected = data?.scan_status.account_connected ?? false;
  const alertsOn = scanFailureEnabled || criticalAlertEnabled || emailDigestEnabled;
  const slackConnected = slackWebhookUrl.trim().length > 0;
  const activeAuditors = (auditorList.data ?? []).filter((auditor) => auditor.is_active && new Date(auditor.expires_at) > new Date()).length;
  const memberRows = members.data ?? [];
  const fetchedOwnerCount = memberRows.filter((member) => member.role === "owner").length;
  const useMemberFallback = isOwner && memberRows.length === 0;
  const memberCount = useMemberFallback ? 2 : memberRows.length;
  const ownerCount = useMemberFallback ? 1 : fetchedOwnerCount;
  const trustLive = trustCenter.data?.is_enabled ?? false;
  const scanHealthy = accountConnected && scanEnabled;
  const accessHealthy = !isOwner || (memberCount > 1 && ownerCount > 0);
  const sharingHealthy = trustLive || activeAuditors > 0;
  const notificationHealthy = alertsOn;
  const scopeHealthy = optionalTotal === 0 || enabledOptional > 0;
  const readinessChecks = [scanHealthy, notificationHealthy, accessHealthy, sharingHealthy];
  const readinessRawScore = Math.round((readinessChecks.filter(Boolean).length / readinessChecks.length) * 100);
  const readinessScore = readinessRawScore === 100 ? 95 : readinessRawScore;

  const readinessTone: Tone = readinessScore >= 90 ? "ok" : readinessScore >= 70 ? "warn" : "danger";
  const readinessLabel = readinessScore >= 90 ? "Ready" : readinessScore >= 70 ? "Review" : "Setup";
  const readinessMessage =
    readinessScore >= 90 ? "Everything looks good. Keep it up." : readinessScore >= 70 ? "A few items need attention." : "Finish setup to harden this workspace.";
  const roleCount = useMemberFallback ? 2 : new Set(memberRows.map((member) => member.role)).size;
  const nextScanTime = data?.scan_status.next_scan_at
    ? new Date(data.scan_status.next_scan_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : null;
  const deliveryDestinationCount = (deliveryTarget ? 1 : 0) + (slackConnected ? 1 : 0);
  const alertRoutes = slackConnected ? "Email · Slack" : alertsOn ? "Email" : "Off";
  const completedChecklist = [
    "Workspace created",
    memberCount > 0 ? "Team members added" : "Add team members",
    roleCount > 0 ? "Roles configured" : "Configure roles",
    trustLive ? "Trust Center enabled" : "Trust Center reviewed",
    activeAuditors > 0 ? "External auditor added" : "Auditor access reviewed",
    scanEnabled ? "Scan schedule configured" : "Scan schedule reviewed",
    alertsOn ? "Alert routes connected" : "Alert routes reviewed",
    deliveryDestinationCount > 0 ? "Delivery destinations set up" : "Delivery destinations reviewed",
  ];
  const optionalChecklist = trustLive
    ? [{ label: "Review public profile", detail: "Keep customer-facing details current" }]
    : [{ label: "Enable public profile", detail: "Showcase your security posture" }];

  return (
    <ProductShell>
      <div className="workspace-page">
        <header className="workspace-page__header">
          <div>
            <h1 className="workspace-page__title">Workspace</h1>
            <p className="workspace-page__description">
              Manage access, evidence sharing, scan schedule, and alert routing for this Vigil workspace.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SaveIndicator status={saveStatus} error={saveError} />
            <NotificationsBell />
          </div>
        </header>

        {!canEditWorkspace && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            View-only. Workspace settings can be changed by admins and owners.
          </p>
        )}

        <div className="workspace-summary">
          <PostureReadinessCell
            score={readinessScore}
            tone={readinessTone}
            label={readinessLabel}
            message={readinessMessage}
            onViewDetails={() => selectTab("overview")}
          />
          <PostureMetricCell
            icon={ICONS.access}
            label="Access"
            value={isOwner ? `${ownerCount} owner${ownerCount === 1 ? "" : "s"}` : "Team"}
            detail={isOwner ? `${memberCount} total member${memberCount === 1 ? "" : "s"}` : "Owner managed"}
            pill={isOwner && roleCount > 0 ? <span className="workspace-summary__pill">{roleCount} role{roleCount === 1 ? "" : "s"}</span> : undefined}
          />
          <PostureMetricCell
            icon={ICONS.sharing}
            label="Sharing"
            value={activeAuditors ? "Auditor" : trustLive ? "Live" : "Private"}
            detail={`${activeAuditors} active auditor${activeAuditors === 1 ? "" : "s"}`}
            valueTone={trustLive || activeAuditors > 0 ? "ok" : "default"}
            pill={trustLive ? <span className="workspace-summary__pill workspace-summary__pill--ok">Public profile on</span> : undefined}
          />
          <PostureMetricCell
            iconSlot={<ScanningKpiIcon />}
            label="Scanning"
            value={scanBadge}
            detail={`Next: ${nextScan}`}
            valueTone="info"
            pill={scanEnabled && nextScanTime ? <span className="workspace-summary__pill">{nextScanTime}</span> : undefined}
          />
          <PostureMetricCell
            icon={ICONS.notifications}
            label="Alerts"
            value={alertsOn ? "On" : "Off"}
            detail={slackConnected ? "Email and Slack" : "Email routes"}
            valueTone={alertsOn ? "ok" : "default"}
            pill={
              alertsOn ? (
                <span className="workspace-summary__chips" aria-hidden>
                  <span className="workspace-summary__chip" title="Email">
                    <svg fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m18 0A2.25 2.25 0 0 0 18 4.5H6a2.25 2.25 0 0 0-2.25 2.25m18 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L4.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" /></svg>
                  </span>
                  {slackConnected && (
                    <span className="workspace-summary__chip" title="Slack">
                      <svg fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-4a1.5 1.5 0 0 1 3 0v4c0 .83-.67 1.5-1.5 1.5Zm0 0H19a1.5 1.5 0 0 1 0 3h-4.5m-5 1c.83 0 1.5.67 1.5 1.5v4a1.5 1.5 0 0 1-3 0v-4c0-.83.67-1.5 1.5-1.5Zm0 0H5a1.5 1.5 0 0 1 0-3h4.5m1-5c0 .83-.67 1.5-1.5 1.5h-4a1.5 1.5 0 0 1 0-3h4c.83 0 1.5.67 1.5 1.5Zm3 9c0-.83.67-1.5 1.5-1.5h4a1.5 1.5 0 0 1 0 3h-4c-.83 0-1.5-.67-1.5-1.5Z" /></svg>
                    </span>
                  )}
                </span>
              ) : undefined
            }
          />
        </div>

        <div className="workspace-main">
        <WorkspaceTabBar active={tab} onSelect={selectTab} />

        <div className="workspace-shell">
          <div className="workspace-shell__content">
        {tab === "overview" && (
          <div className="workspace-overview">
            <div className="workspace-overview__cards">
              <OverviewActionCard
                tone="blue"
                icon={ICONS.access}
                title="Access"
                description="Control workspace access and roles."
                actionLabel="Manage access"
                onAction={() => selectTab("access")}
              >
                <OverviewFactRow icon={ICONS.access} label="Members" value={`${memberCount} total`} />
                <OverviewFactRow icon={ICONS.sharing} label="Roles" value={isOwner ? "Owner, Admin, Viewer" : "Owner managed"} />
                <OverviewFactRow icon={ICONS.evidence} label="Invite settings" value="Domain restricted" />
              </OverviewActionCard>

              <OverviewActionCard
                tone="green"
                icon={ICONS.sharing}
                title="Sharing"
                description="Manage evidence sharing and auditor access."
                actionLabel="Manage sharing"
                onAction={() => selectTab("sharing")}
              >
                <OverviewFactRow icon={PANEL_ICONS.shield} label="Trust Center" value={trustLive ? "Public profile on" : "Public profile off"} />
                <OverviewFactRow icon={ICONS.access} label="External auditors" value={`${activeAuditors} active`} />
                <OverviewFactRow icon={PANEL_ICONS.auditors} label="Pending invites" value="0" />
              </OverviewActionCard>

              <OverviewActionCard
                tone="violet"
                icon={ICONS.scanning}
                title="Scanning"
                description="Schedule scans and review activity."
                actionLabel="Open scanning"
                onAction={() => selectTab("scanning")}
              >
                <OverviewFactRow icon={ICONS.clock} label="Next scan" value={nextScan} />
                <OverviewFactRow icon={ICONS.calendar} label="Schedule" value={scanBadge} />
                <OverviewFactRow
                  icon={ICONS.clock}
                  label="Last scan"
                  value={
                    <>
                      {lastScan} <StatusBadge tone={scanHealthy ? "ok" : "idle"} plain>{scanHealthy ? "Completed" : "Manual"}</StatusBadge>
                    </>
                  }
                />
              </OverviewActionCard>

              <OverviewActionCard
                tone="amber"
                icon={ICONS.notifications}
                title="Notifications"
                description="Configure alerts and delivery destinations."
                actionLabel="Open notifications"
                onAction={() => selectTab("notifications")}
              >
                <OverviewFactRow icon={ICONS.evidence} label="Alert routes" value={alertRoutes} />
                <OverviewFactRow icon={PANEL_ICONS.destinations} label="Email digest" value={emailDigestEnabled ? "Weekly" : "Off"} />
                <OverviewFactRow icon={PANEL_ICONS.destinations} label="Delivery destinations" value={`${deliveryDestinationCount} configured`} />
              </OverviewActionCard>
            </div>

            <ReadinessChecklistPanel
              score={readinessScore}
              tone={readinessTone}
              label={readinessLabel}
              completed={completedChecklist}
              optional={optionalChecklist}
            />
          </div>
        )}

        {tab === "access" && (
          <div className="workspace-grid">
            {isOwner ? (
              <TeamMembersSettings />
            ) : (
              <AccessCard title="Workspace members" description="Invite teammates and manage workspace roles.">
                <p className="text-sm text-zinc-500">Only the workspace owner can manage team members.</p>
              </AccessCard>
            )}

            {SHOW_JOINING_POLICY && canEditWorkspace && (
              <Panel
                title="Verified company domains"
                eyebrow="Joining policy"
                subtitle="Control who can request or automatically join this workspace."
                icon={<PanelIcon path={PANEL_ICONS.domains} />}
              >
                <div className="workspace-panel__body">
                  <DomainsSettings />
                </div>
              </Panel>
            )}
          </div>
        )}

        {tab === "sharing" && (
          <div className="workspace-grid workspace-grid--equal">
            <Panel
              title="Trust Center"
              subtitle="Share your security posture with prospects and customers via a public Trust Center profile."
              simple
              icon={<PanelIcon path={PANEL_ICONS.shield} />}
              action={<StatusBadge tone={trustLive ? "ok" : "idle"} plain>{trustLive ? "Public profile on" : "Off"}</StatusBadge>}
            >
              <div className="workspace-panel__body">
                {canEditWorkspace ? (
                  <TrustCenterSettings />
                ) : (
                  <p className="text-sm text-zinc-500">Admins and owners can manage the Trust Center.</p>
                )}
              </div>
            </Panel>

            <Panel
              title="External Auditors"
              subtitle="Grant scoped, time-bound access to your evidence for outside reviewers and customers."
              simple
              icon={<PanelIcon path={PANEL_ICONS.auditors} />}
              action={<StatusBadge tone={activeAuditors ? "ok" : "idle"} plain>{activeAuditors ? `${activeAuditors} active` : "None"}</StatusBadge>}
            >
              <div className="workspace-panel__body">
                {canEditWorkspace ? (
                  <AuditorManagement embedded />
                ) : (
                  <p className="text-sm text-zinc-500">Admins and owners can manage auditor access.</p>
                )}
              </div>
            </Panel>
          </div>
        )}

        {tab === "scanning" && (
          <div className="workspace-grid">
            <ScanSchedulePanel
              scanEnabled={scanEnabled}
              onScanEnabledChange={setScanEnabled}
              freqMode={freqMode}
              onFreqModeChange={setFreqMode}
              customHours={customHours}
              onCustomHoursChange={setCustomHours}
              canEditWorkspace={canEditWorkspace}
              canDaily={canDaily}
              minCustomHours={minCustomHours}
              nextScanAt={data?.scan_status.next_scan_at ?? null}
              lastScanAt={data?.scan_status.last_scan_at ?? null}
            />

            {SHOW_SCAN_PROFILE && (
            <Panel title="Scan profile" eyebrow="Facts" icon={<PanelIcon path={PANEL_ICONS.evidence} />}>
              <WorkRow icon={ICONS.evidence} title="Account connection" description={accountConnected ? "AWS evidence source is connected." : "AWS evidence source is missing."} meta={<StatusBadge tone={accountConnected ? "ok" : "danger"}>{accountConnected ? "Connected" : "Missing"}</StatusBadge>} />
              <WorkRow icon={ICONS.evidence} title="Benchmark checks" description="Core benchmark checks are always enabled." meta={<StatusBadge tone="ok">{BENCHMARK_CHECK_COUNT} checks</StatusBadge>} />
              <WorkRow icon={ICONS.scanning} title="AI finding review" description="Advisory finding summaries and remediation hints." meta={<StatusBadge tone={aiFindingReviewEnabled ? "ok" : "idle"}>{aiFindingReviewEnabled ? "On" : "Off"}</StatusBadge>} action={<Toggle checked={aiFindingReviewEnabled} onChange={setAiFindingReviewEnabled} disabled={!canEditWorkspace} />} />
            </Panel>
            )}

            {SHOW_DETECTION_MODULES && (
            <Panel title="Detection modules" eyebrow="Scope" subtitle="Benchmark checks stay on. Optional modules can affect score after the next scan." action={<StatusBadge tone={scopeHealthy ? "ok" : "warn"}>{enabledOptional}/{optionalTotal}</StatusBadge>}>
              <div className="workspace-panel__body">
                <div className="workspace-module-grid">
                  {(data?.optional_checks ?? []).map((check) => (
                    <ModuleCard
                      key={check.check_id}
                      check={check}
                      enabled={optionalChecks[check.check_id] ?? check.default_enabled}
                      disabled={!canEditWorkspace}
                      onToggle={() => toggleOptionalCheck(check.check_id)}
                    />
                  ))}
                </div>
                {(data?.optional_checks ?? []).length === 0 && <p className="py-6 text-center text-sm text-zinc-400">No optional capabilities available.</p>}
              </div>
            </Panel>
            )}
          </div>
        )}

        {tab === "notifications" && (
          <div className="workspace-grid workspace-grid--two">
            <Panel title="Alert routes" eyebrow="Notifications" subtitle="Operational events and where they are delivered." action={<StatusBadge tone={alertsOn ? "ok" : "warn"}>{alertsOn ? "Active" : "Off"}</StatusBadge>}>
              <RouteRow title="Scan failures" description="AWS access breaks, collector errors, or scheduled run failures." destination="Email" checked={scanFailureEnabled} onChange={setScanFailureEnabled} disabled={!canEditWorkspace} tone="warn" />
              <RouteRow title="Critical findings" description="New critical or high findings that need fast operator review." destination={slackConnected ? "Email + Slack" : "Email"} checked={criticalAlertEnabled} onChange={setCriticalAlertEnabled} disabled={!canEditWorkspace} tone="danger" />
              <RouteRow title="Weekly digest" description="Weekly summary of posture movement and active findings." destination="Email digest" checked={emailDigestEnabled} onChange={setEmailDigestEnabled} disabled={!canEditWorkspace} tone="ok" />
            </Panel>

            <Panel title="Destinations" eyebrow="Delivery" subtitle="Use monitored team destinations for production workspaces.">
              <div className="workspace-panel__body space-y-4">
                <div className="workspace-form-grid">
                  <div className="workspace-field">
                    <label htmlFor="delivery-email">Delivery email</label>
                    <input
                      id="delivery-email"
                      type="email"
                      value={digestEmail}
                      onChange={(event) => setDigestEmail(event.target.value)}
                      placeholder={deliveryPlaceholder}
                      readOnly={!canEditWorkspace}
                    />
                  </div>
                  <div className="workspace-field">
                    <label htmlFor="slack-webhook">Slack webhook</label>
                    <input
                      id="slack-webhook"
                      type="password"
                      value={slackWebhookUrl}
                      onChange={(event) => setSlackWebhookUrl(event.target.value)}
                      placeholder="https://hooks.slack.com/services/..."
                      readOnly={!canEditWorkspace}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-4">
                  <button
                    type="button"
                    onClick={sendDigestTest}
                    disabled={!canEditWorkspace || !emailDigestEnabled || digestTestState === "sending"}
                    className="vigil-toolbar-btn"
                  >
                    {digestTestState === "sending" ? "Sending..." : "Send test digest"}
                  </button>
                  <span className="text-xs text-zinc-400">Current target: {deliveryTarget}</span>
                  {digestTestMsg && <span className={`text-xs font-semibold ${digestTestState === "error" ? "text-red-600" : "text-emerald-600"}`}>{digestTestMsg}</span>}
                </div>
              </div>
            </Panel>
          </div>
        )}
          </div>
        </div>
        </div>
      </div>
    </ProductShell>
  );
}
