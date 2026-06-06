import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { ProductShell } from "../components/ProductShell";
import { useAccountScanRun } from "../hooks/useAccountScanRun";
import { useIntegrationSyncState } from "../hooks/useIntegrationSyncState";
import {
  anyRemediationEnabled,
  DEFAULT_REMEDIATION_MODULES,
  type RemediationModules,
} from "../data/remediationModules";
import {
  AwsBrandTile,
  formatSync,
  GitHubMark,
  GitLabMark,
  IconClock,
  IconShield,
  IconSync,
  SlackMark,
  Spinner,
  StatusDot,
} from "../components/IntegrationsUi";

type ProviderSummary = {
  id: string;
  status: string;
  last_synced_at: string | null;
  repos: number;
  pull_requests: number;
};

type AccountRow = {
  id: string;
  status: string;
  account_id: string | null;
  label: string;
  last_scan_at: string | null;
  remediation_modules: RemediationModules;
};

const AWS_INTEGRATION_VALUE_PROP_DEFAULT =
  "Read-only AWS posture scans mapped to SOC 2, CIS, and ISO controls, plus evidence packs.";

const AWS_INTEGRATION_VALUE_PROP_WITH_REMEDIATION =
  "Read-only AWS posture scans mapped to SOC 2, CIS, and ISO controls, plus evidence packs and SSM remediation.";

function awsIntegrationValueProp(account: AccountRow | undefined): string {
  if (!account) return AWS_INTEGRATION_VALUE_PROP_DEFAULT;
  const modules = account.remediation_modules ?? DEFAULT_REMEDIATION_MODULES;
  if (anyRemediationEnabled(modules)) return AWS_INTEGRATION_VALUE_PROP_WITH_REMEDIATION;
  return AWS_INTEGRATION_VALUE_PROP_DEFAULT;
}

type SettingsSlice = {
  notifications: {
    slack_webhook_url: string | null;
    email_digest_enabled: boolean;
  };
};

type Tone = "ok" | "warn" | "idle" | "sync";

type IntegrationCard = {
  name: string;
  valueProp: string;
  icon: ReactNode;
  iconBg: string;
  framedIcon?: boolean;
  connected?: boolean;
  syncing?: boolean;
  loading?: boolean;
  href: string;
  cta: string;
  evidenceTypes: string[];
  lastSync: string;
  permissionsLabel: string;
  healthLabel: string;
  healthTone?: Tone;
  primarySource?: boolean;
  accent?: "primary" | "connected" | "none";
};

type SummaryMetric = {
  label: string;
  value: string | number;
  tone?: Tone;
};

function integrationCta(connected: boolean): string {
  return connected ? "Manage" : "Connect";
}

function integrationStatus(card: IntegrationCard): { label: string; tone: Tone } {
  if (card.loading) return { label: "Loading", tone: "idle" };
  if (card.syncing) return { label: "Syncing", tone: "sync" };
  if (card.connected) return { label: "Connected", tone: "ok" };
  return { label: "Not connected", tone: "idle" };
}

function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  const cls =
    tone === "ok"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : tone === "sync"
          ? "bg-sky-50 text-sky-700 ring-sky-200"
          : "bg-zinc-100 text-zinc-500 ring-zinc-200";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${cls}`}
    >
      {tone === "sync" && <Spinner className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

function PrimarySourceBadge() {
  return (
    <span className="inline-flex shrink-0 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-200">
      Primary source
    </span>
  );
}

function StatValue({ value, tone }: { value: string; tone?: Tone }) {
  if (!tone) {
    return <p className="mt-1 truncate text-sm font-semibold text-zinc-900">{value}</p>;
  }
  return (
    <p className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-zinc-900">
      {tone === "sync" ? (
        <Spinner className="h-3.5 w-3.5 shrink-0 text-sky-600" />
      ) : (
        <StatusDot tone={tone} />
      )}
      <span className="truncate">{value}</span>
    </p>
  );
}

function StatsRow({
  children,
  compact,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  const spacing = compact ? "mt-4" : "mt-5";
  return (
    <div className={spacing}>
      <div className="grid gap-3 sm:grid-cols-3">{children}</div>
    </div>
  );
}

function StatColumn({
  icon,
  label,
  value,
  valueTone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  valueTone?: Tone;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-100 bg-zinc-50/70 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
        <span className="text-zinc-400">{icon}</span>
        {label}
      </div>
      <StatValue value={value} tone={valueTone} />
    </div>
  );
}

function EvidenceTags({ types }: { types: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {types.map((t) => (
        <span
          key={t}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-600"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function IconGear({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function CardAction({ href, label, connect = false }: { href: string; label: string; connect?: boolean }) {
  return (
    <Link
      to={href}
      className={`inline-flex min-w-[116px] items-center justify-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm font-semibold transition ${
        connect
          ? "border-indigo-200 bg-indigo-600 text-white shadow-sm shadow-indigo-950/10 hover:border-indigo-600 hover:bg-indigo-700"
          : "border-indigo-200 bg-white text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50/40"
      }`}
    >
      {connect ? <IconSync className="h-4 w-4" /> : <IconGear className="h-4 w-4" />}
      {label}
    </Link>
  );
}

function IntegrationCardView({ card }: { card: IntegrationCard }) {
  const status = integrationStatus(card);
  const accentCls =
    card.accent === "primary"
      ? "border-l-[3px] border-l-sky-400"
      : card.accent === "connected"
        ? "border-l-[3px] border-l-emerald-400"
        : "";

  return (
    <article
      className={`flex min-h-[17rem] flex-col overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-sm shadow-zinc-950/[0.035] transition hover:border-zinc-300/80 hover:shadow-md hover:shadow-zinc-950/[0.055] ${accentCls}`}
    >
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3.5">
          {card.framedIcon ? (
            card.icon
          ) : (
            <span
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${card.iconBg}`}
            >
              <span className="h-6 w-6">{card.icon}</span>
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold tracking-[-0.01em] text-zinc-950">{card.name}</h2>
              <StatusPill label={status.label} tone={status.tone} />
              {card.primarySource && <PrimarySourceBadge />}
            </div>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-zinc-600">{card.valueProp}</p>
          </div>
        </div>

        <StatsRow compact>
          <StatColumn icon={<IconClock className="h-3.5 w-3.5" />} label="Last collection" value={card.lastSync} />
          <StatColumn
            icon={<IconSync className="h-3.5 w-3.5" />}
            label="Sync"
            value={card.healthLabel}
            valueTone={card.healthTone}
          />
          <StatColumn icon={<IconShield className="h-3.5 w-3.5" />} label="Permissions" value={card.permissionsLabel} />
        </StatsRow>
      </div>

      <div className="mt-auto flex flex-wrap items-end justify-between gap-3 border-t border-[#d9e2ee] bg-slate-50/60 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]">
        <EvidenceTags types={card.evidenceTypes} />
        <CardAction href={card.href} label={card.cta} connect={!card.connected && card.cta === "Connect"} />
      </div>
    </article>
  );
}

function SummaryStrip({ items }: { items: SummaryMetric[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200/90 bg-white px-4 py-3 shadow-sm shadow-zinc-950/[0.025]"
        >
          <span className="text-[12px] font-semibold text-zinc-500">{item.label}</span>
          <span className="flex items-center gap-2 text-lg font-bold tabular-nums tracking-[-0.02em] text-zinc-950">
            {item.tone && <StatusDot tone={item.tone} />}
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function IntegrationSection({
  title,
  description,
  cards,
}: {
  title: string;
  description: string;
  cards: IntegrationCard[];
}) {
  if (cards.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-zinc-400">{title}</h2>
        <p className="mt-1 text-sm text-zinc-500">{description}</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {cards.map((card) => (
          <IntegrationCardView key={card.name} card={card} />
        ))}
      </div>
    </section>
  );
}

function ScanProgressBanner() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5 text-sm text-sky-950">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-600 ring-1 ring-sky-200">
          <Spinner className="h-4 w-4" />
        </span>
        <p>
          <span className="font-semibold">AWS scan in progress</span>
          <span className="text-sky-800/80"> We&apos;re syncing your AWS environment and refreshing findings.</span>
        </p>
      </div>
      <Link
        to="/accounts"
        className="shrink-0 text-sm font-semibold text-sky-700 transition hover:text-sky-900"
      >
        View progress &gt;
      </Link>
    </div>
  );
}

function IntegrationsContent() {
  const qc = useQueryClient();
  const prevScanStatus = useRef<string | null>(null);

  const github = useQuery({ queryKey: ["github-provider"], queryFn: () => api<ProviderSummary | null>("/v1/integrations/github") });
  const gitlab = useQuery({ queryKey: ["gitlab-provider"], queryFn: () => api<ProviderSummary | null>("/v1/integrations/gitlab") });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<AccountRow[]>("/v1/accounts") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<SettingsSlice>("/v1/settings") });

  const awsAccount = accounts.data?.find((a) => a.status === "connected") ?? accounts.data?.[0];
  const connectedAccountId = awsAccount?.id;
  const { isRunning: awsScanRunning, scanStatus } = useAccountScanRun(connectedAccountId);
  const githubSync = useIntegrationSyncState("github");
  const gitlabSync = useIntegrationSyncState("gitlab");

  useEffect(() => {
    if (prevScanStatus.current === "running" && scanStatus === "ok") {
      qc.invalidateQueries({ queryKey: ["github-provider"] });
      qc.invalidateQueries({ queryKey: ["gitlab-provider"] });
    }
    prevScanStatus.current = scanStatus;
  }, [scanStatus, qc]);

  const slackConnected = !!settings.data?.notifications.slack_webhook_url?.trim();
  const connectedCount = [awsAccount?.status === "connected", !!github.data, !!gitlab.data, slackConnected].filter(
    Boolean,
  ).length;
  const syncingCount = [awsScanRunning, githubSync.isSyncing, gitlabSync.isSyncing].filter(Boolean).length;
  const errorCount = [accounts.isError, github.isError, gitlab.isError, settings.isError].filter(Boolean).length;

  const awsCard: IntegrationCard = {
    name: "AWS",
    valueProp: awsIntegrationValueProp(awsAccount),
    icon: <AwsBrandTile className="h-14 w-14 p-2.5" />,
    iconBg: "",
    framedIcon: true,
    href: "/accounts",
    cta: integrationCta(awsAccount?.status === "connected"),
    connected: awsAccount?.status === "connected",
    syncing: awsScanRunning,
    loading: accounts.isLoading,
    primarySource: true,
    accent: "primary",
    evidenceTypes: ["IAM", "S3", "KMS", "CloudTrail", "Remediation"],
    lastSync: formatSync(awsAccount?.last_scan_at ?? null) || "—",
    healthLabel: awsScanRunning ? "Scanning" : awsAccount?.last_scan_at ? "Stable" : "Awaiting scan",
    healthTone: awsScanRunning ? "sync" : awsAccount?.last_scan_at ? "ok" : "idle",
    permissionsLabel: awsAccount?.status === "connected" ? "Connector verified" : "Not connected",
  };

  const githubCard: IntegrationCard = {
    name: "GitHub",
    valueProp: "Change-management evidence from repos and branch protection.",
    icon: <GitHubMark className="h-full w-full" />,
    iconBg: "bg-zinc-950",
    href: "/integrations/github",
    cta: integrationCta(!!github.data),
    connected: !!github.data,
    syncing: githubSync.isSyncing,
    loading: github.isLoading,
    accent: github.data ? "connected" : "none",
    evidenceTypes: ["Branch protection", "Reviews"],
    lastSync: formatSync(github.data?.last_synced_at ?? null) || "—",
    healthLabel: githubSync.isSyncing ? "Syncing" : github.data ? "Stable" : "Not configured",
    healthTone: githubSync.isSyncing ? "sync" : github.data ? "ok" : undefined,
    permissionsLabel: github.data ? "OAuth connected" : "Not connected",
  };

  const gitlabCard: IntegrationCard = {
    name: "GitLab",
    valueProp: "Group and project policy evidence for merge requests.",
    icon: <GitLabMark className="h-full w-full" />,
    iconBg: "bg-[#e24329]",
    href: "/integrations/gitlab",
    cta: integrationCta(!!gitlab.data),
    connected: !!gitlab.data,
    syncing: gitlabSync.isSyncing,
    loading: gitlab.isLoading,
    accent: gitlab.data ? "connected" : "none",
    evidenceTypes: ["Protected branches", "MR approvals"],
    lastSync: formatSync(gitlab.data?.last_synced_at ?? null) || "—",
    healthLabel: gitlabSync.isSyncing ? "Syncing" : gitlab.data ? "Stable" : "Not configured",
    healthTone: gitlabSync.isSyncing ? "sync" : gitlab.data ? "ok" : undefined,
    permissionsLabel: gitlab.data ? "OAuth connected" : "Not connected",
  };

  const slackCard: IntegrationCard = {
    name: "Slack",
    valueProp: "Weekly digests and scan-failure alerts to your channel.",
    icon: <SlackMark className="h-full w-full" />,
    iconBg: "bg-[#4A154B]",
    href: "/settings",
    cta: integrationCta(slackConnected),
    connected: slackConnected,
    loading: settings.isLoading,
    accent: "none",
    evidenceTypes: ["Digest", "Alerts"],
    lastSync: slackConnected ? "Webhook active" : "—",
    healthLabel: slackConnected ? "Stable" : "Not configured",
    healthTone: slackConnected ? "ok" : undefined,
    permissionsLabel: slackConnected ? "Webhook configured" : "Not configured",
  };
  const allCards = [awsCard, githubCard, gitlabCard, slackCard];
  const connectedCards = allCards.filter((card) => card.primarySource || card.connected || card.syncing);
  const availableCards = allCards.filter((card) => !connectedCards.includes(card));
  const evidenceSourceCount = connectedCards.filter((card) => card.name !== "Slack").length;
  const summaryMetrics: SummaryMetric[] = [
    { label: "Connected", value: connectedCount, tone: "ok" },
    { label: "Syncing", value: syncingCount, tone: syncingCount > 0 ? "sync" : "idle" },
    { label: "Errors", value: errorCount, tone: errorCount > 0 ? "warn" : "idle" },
    { label: "Evidence sources", value: evidenceSourceCount, tone: evidenceSourceCount > 0 ? "ok" : "idle" },
  ];

  return (
    <div className="min-h-full bg-[#f8fafc]">
      <div className="w-full space-y-6 pb-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Integrations</h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-500">
              Connected sources that feed findings, compliance mapping, and audit evidence.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
            {connectedCount} connected
          </span>
        </header>

        <SummaryStrip items={summaryMetrics} />

        {awsScanRunning && <ScanProgressBanner />}

        <IntegrationSection
          title="Connected sources"
          description="Active sources that feed findings, compliance mappings, and audit evidence."
          cards={connectedCards}
        />
        <IntegrationSection
          title="Available integrations"
          description="Optional destinations and evidence sources you can connect next."
          cards={availableCards}
        />
      </div>
    </div>
  );
}

export default function Integrations() {
  return (
    <ProductShell>
      <IntegrationsContent />
    </ProductShell>
  );
}
