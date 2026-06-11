import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { ProductShell } from "../components/ProductShell";
import NotificationsBell from "../components/NotificationsBell";
import { useAccountScanRun } from "../hooks/useAccountScanRun";
import { useIntegrationSyncState } from "../hooks/useIntegrationSyncState";
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
};

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
    <div className={`${spacing} overflow-hidden rounded-xl border border-slate-200/70 bg-slate-50/60`}>
      <div className="grid divide-y divide-slate-200/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">{children}</div>
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
    <div className="min-w-0 px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
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
          className="rounded-md border border-[#edf1f6] bg-[#f8fafc] px-2.5 py-1.5 text-[12px] font-medium text-[#5f6673]"
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

function CardAction({
  href,
  label,
  connect = false,
  accent = "none",
}: {
  href: string;
  label: string;
  connect?: boolean;
  accent?: IntegrationCard["accent"];
}) {
  const manageAccentCls =
    !connect && accent === "primary"
      ? "border-l-[3px] border-l-transparent hover:border-l-sky-400"
      : !connect && accent === "connected"
        ? "border-l-[3px] border-l-transparent hover:border-l-emerald-400"
        : "";

  return (
    <Link
      to={href}
      className={`vigil-toolbar-btn min-w-[116px] px-4 ${
        connect
          ? "vigil-toolbar-btn--neutral"
          : `border-slate-200 font-semibold text-slate-700 shadow-sm shadow-slate-950/[0.03] hover:-translate-y-px hover:border-zinc-300 hover:bg-zinc-50 hover:shadow-md hover:shadow-zinc-950/[0.07] ${manageAccentCls}`
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
            <p className="mt-1.5 truncate text-sm text-zinc-600">{card.valueProp}</p>
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

      <div className="mt-auto flex flex-wrap items-end justify-between gap-3 border-t border-slate-300/80 bg-slate-50/60 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
        <EvidenceTags types={card.evidenceTypes} />
        <CardAction
          href={card.href}
          label={card.cta}
          connect={!card.connected && card.cta === "Connect"}
          accent={card.accent}
        />
      </div>
    </article>
  );
}

function SummaryStrip({ items }: { items: SummaryMetric[] }) {
  const railClass: Record<Tone, string> = {
    ok: "bg-emerald-400",
    sync: "bg-indigo-400",
    warn: "bg-amber-400",
    idle: "bg-slate-300",
  };
  const valueClass: Record<Tone, string> = {
    ok: "text-slate-950",
    sync: "text-slate-950",
    warn: "text-amber-700",
    idle: "text-slate-950",
  };

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="relative overflow-hidden rounded-xl border border-zinc-200/90 bg-white px-4 py-3.5 shadow-sm shadow-zinc-950/[0.025]"
        >
          {item.tone && <span className={`absolute inset-y-3 left-0 w-0.5 rounded-r-full ${railClass[item.tone]}`} />}
          <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{item.label}</span>
          <span
            className={`mt-2 block text-2xl font-extrabold leading-none tabular-nums tracking-[-0.03em] ${
              item.tone ? valueClass[item.tone] : "text-slate-950"
            }`}
          >
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

type CatalogueEntry = {
  name: string;
  href?: string;
  icon: ReactNode;
  iconBg: string;
  comingSoon?: boolean;
};

const COMING_SOON_CATALOGUE: CatalogueEntry[] = [
  {
    name: "Jira",
    comingSoon: true,
    iconBg: "bg-[#0052CC]",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden fill="currentColor">
        <path d="M11.53 2C6.82 2 3 5.82 3 10.53c0 2.31 1.01 4.39 2.61 5.82L2 22l5.92-3.47A9.42 9.42 0 0 0 11.53 19c4.71 0 8.53-3.82 8.53-8.47C20.06 5.82 16.24 2 11.53 2Z" />
      </svg>
    ),
  },
  {
    name: "Azure DevOps",
    comingSoon: true,
    iconBg: "bg-[#0078D4]",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden fill="currentColor">
        <path d="M5.4 4.2h8.28l-1.02 5.58 5.94-2.78L8.9 19.8 7.2 12.6l-4.5 2.1L5.4 4.2z" />
      </svg>
    ),
  },
  {
    name: "Datadog",
    comingSoon: true,
    iconBg: "bg-[#632CA6]",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden fill="currentColor">
        <path d="M12 3c-4.2 0-7.6 3.1-8.2 7.1l2.1.4c.5-3 3.1-5.2 6.1-5.2 3.4 0 6.2 2.8 6.2 6.2s-2.8 6.2-6.2 6.2c-1.6 0-3-.6-4.1-1.7L4.8 18.2A9.9 9.9 0 0 0 12 21c5.5 0 10-4.5 10-10S17.5 3 12 3Zm-1.1 5.8v4.4l3.8 2.2.9-1.5-2.9-1.7V8.8l-1.8-1Z" />
      </svg>
    ),
  },
];

function CatalogueTile({ entry }: { entry: CatalogueEntry }) {
  const body = (
    <>
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white shadow-sm ${entry.iconBg} ${
          entry.comingSoon ? "opacity-80" : ""
        }`}
      >
        {entry.icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-zinc-950">{entry.name}</p>
        <p className={`text-[11px] font-medium ${entry.comingSoon ? "text-zinc-400" : "text-indigo-600"}`}>
          {entry.comingSoon ? "Coming soon" : "Connect"}
        </p>
      </div>
    </>
  );

  const cls =
    "flex w-[11.5rem] shrink-0 items-center gap-3 rounded-xl border border-zinc-200/90 bg-white px-3.5 py-3 shadow-sm shadow-zinc-950/[0.025]";

  if (entry.comingSoon || !entry.href) {
    return <div className={`${cls} opacity-75`}>{body}</div>;
  }

  return (
    <Link
      to={entry.href}
      className={`${cls} transition hover:border-indigo-200 hover:bg-indigo-50/30 hover:shadow-md hover:shadow-zinc-950/[0.04]`}
    >
      {body}
    </Link>
  );
}

function AvailableIntegrationsCatalogue({ slack }: { slack: IntegrationCard | null }) {
  const entries: CatalogueEntry[] = [
    ...(slack
      ? [
          {
            name: slack.name,
            href: slack.href,
            iconBg: slack.iconBg,
            icon: <span className="h-4 w-4">{slack.icon}</span>,
          } satisfies CatalogueEntry,
        ]
      : []),
    ...COMING_SOON_CATALOGUE,
  ];

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-zinc-400">Available integrations</h2>
        <p className="mt-1 text-sm text-zinc-500">Optional destinations and alerts you can connect next.</p>
      </div>
      <div className="flex flex-wrap gap-3">{entries.map((entry) => <CatalogueTile key={entry.name} entry={entry} />)}</div>
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
  const googleWorkspace = useQuery({ queryKey: ["google-workspace-provider"], queryFn: () => api<ProviderSummary | null>("/v1/integrations/google-workspace") });
  const entra = useQuery({ queryKey: ["entra-provider"], queryFn: () => api<ProviderSummary | null>("/v1/integrations/entra") });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api<AccountRow[]>("/v1/accounts") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<SettingsSlice>("/v1/settings") });

  const awsAccount = accounts.data?.find((a) => a.status === "connected") ?? accounts.data?.[0];
  const connectedAccountId = awsAccount?.id;
  const { isRunning: awsScanRunning, scanStatus } = useAccountScanRun(connectedAccountId);
  const githubSync = useIntegrationSyncState("github");
  const gitlabSync = useIntegrationSyncState("gitlab");
  const googleWorkspaceSync = useIntegrationSyncState("google-workspace");
  const entraSync = useIntegrationSyncState("entra");

  useEffect(() => {
    if (prevScanStatus.current === "running" && scanStatus === "ok") {
      qc.invalidateQueries({ queryKey: ["github-provider"] });
      qc.invalidateQueries({ queryKey: ["gitlab-provider"] });
    }
    prevScanStatus.current = scanStatus;
  }, [scanStatus, qc]);

  const slackConnected = !!settings.data?.notifications.slack_webhook_url?.trim();
  const connectedCount = [awsAccount?.status === "connected", !!github.data, !!gitlab.data, !!googleWorkspace.data, !!entra.data, slackConnected].filter(
    Boolean,
  ).length;
  const syncingCount = [awsScanRunning, githubSync.isSyncing, gitlabSync.isSyncing, googleWorkspaceSync.isSyncing, entraSync.isSyncing].filter(Boolean).length;
  const errorCount = [accounts.isError, github.isError, gitlab.isError, googleWorkspace.isError, entra.isError, settings.isError].filter(Boolean).length;

  const awsCard: IntegrationCard = {
    name: "AWS",
    valueProp: "Posture scans, evidence packs, and SSM remediation.",
    icon: <AwsBrandTile className="h-14 w-14 p-1.5" />,
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
    valueProp: "Evidence from repositories, reviews, and branch protection.",
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
    valueProp: "Evidence from merge requests and project policies.",
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

  const googleWorkspaceCard: IntegrationCard = {
    name: "Google Workspace",
    valueProp: "Directory MFA, inactive users, and admin roster for CC6 evidence.",
    icon: <span className="flex h-full w-full items-center justify-center text-lg font-bold text-white">G</span>,
    iconBg: "bg-[#4285F4]",
    href: "/integrations/google-workspace",
    cta: integrationCta(!!googleWorkspace.data),
    connected: !!googleWorkspace.data,
    syncing: googleWorkspaceSync.isSyncing,
    loading: googleWorkspace.isLoading,
    accent: googleWorkspace.data ? "connected" : "none",
    evidenceTypes: ["MFA enforcement", "Inactive users", "Admin review"],
    lastSync: formatSync(googleWorkspace.data?.last_synced_at ?? null) || "—",
    healthLabel: googleWorkspaceSync.isSyncing ? "Syncing" : googleWorkspace.data ? "Stable" : "Not configured",
    healthTone: googleWorkspaceSync.isSyncing ? "sync" : googleWorkspace.data ? "ok" : undefined,
    permissionsLabel: googleWorkspace.data ? "OAuth connected" : "Not connected",
  };

  const entraCard: IntegrationCard = {
    name: "Microsoft Entra ID",
    valueProp: "Graph directory read for MFA posture, stale users, and privileged roles.",
    icon: <span className="flex h-full w-full items-center justify-center text-lg font-bold text-white">E</span>,
    iconBg: "bg-[#0078D4]",
    href: "/integrations/entra",
    cta: integrationCta(!!entra.data),
    connected: !!entra.data,
    syncing: entraSync.isSyncing,
    loading: entra.isLoading,
    accent: entra.data ? "connected" : "none",
    evidenceTypes: ["MFA posture", "Inactive users", "Admin review"],
    lastSync: formatSync(entra.data?.last_synced_at ?? null) || "—",
    healthLabel: entraSync.isSyncing ? "Syncing" : entra.data ? "Stable" : "Not configured",
    healthTone: entraSync.isSyncing ? "sync" : entra.data ? "ok" : undefined,
    permissionsLabel: entra.data ? "OAuth connected" : "Not connected",
  };

  const slackCard: IntegrationCard = {
    name: "Slack",
    valueProp: "Scan alerts and weekly digests for your channel.",
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
  const allCards = [awsCard, githubCard, gitlabCard, googleWorkspaceCard, entraCard, slackCard];
  const connectedCards = allCards.filter((card) => card.primarySource || card.connected || card.syncing);
  const availableSlack = !slackConnected ? slackCard : null;
  const summaryMetrics: SummaryMetric[] = [
    { label: "Connected", value: connectedCount, tone: "ok" },
    { label: "Syncing", value: syncingCount, tone: syncingCount > 0 ? "sync" : "idle" },
    { label: "Errors", value: errorCount, tone: errorCount > 0 ? "warn" : "idle" },
  ];

  return (
    <div className="min-h-full bg-[#f8fafc]">
      <div className="w-full space-y-6 pb-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Integrations</h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-500">
              Connected sources for findings, compliance mapping, and audit evidence.
            </p>
          </div>
          <NotificationsBell />
        </header>

        <SummaryStrip items={summaryMetrics} />

        {awsScanRunning && <ScanProgressBanner />}

        <IntegrationSection
          title="Connected sources"
          description="Active sources that feed findings, compliance mappings, and audit evidence."
          cards={connectedCards}
        />
        <AvailableIntegrationsCatalogue slack={availableSlack} />
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
