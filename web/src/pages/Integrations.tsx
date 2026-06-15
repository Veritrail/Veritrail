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
  formatSyncDetail,
  IconShield,
  IntegrationBrandIcon,
  Spinner,
  StatusDot,
} from "../components/IntegrationsUi";
import type { IntegrationBrandId } from "../lib/integrationBrands";
import "../styles/integrations-page.css";

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

type IntegrationRow = {
  key: string;
  name: string;
  description: string;
  icon: ReactNode;
  href: string;
  connected: boolean;
  syncing?: boolean;
  loading?: boolean;
  lastSyncAt: string | null;
  lastSyncLabel?: string;
  healthLabel: string;
  healthTone?: Tone;
  permissionsLabel: string;
  permissionsVerified?: boolean;
  capabilities: string[];
};

type ExploreCard = {
  key: string;
  brand: IntegrationBrandId;
  name: string;
  description: string;
  href?: string;
  comingSoon?: boolean;
};

function integrationCta(connected: boolean): string {
  return connected ? "Manage" : "Connect";
}

function CapabilityPills({ tags }: { tags: string[] }) {
  const visible = tags.slice(0, 3);
  const extra = tags.length - visible.length;
  return (
    <div className="integrations-capabilities">
      {visible.map((tag) => (
        <span key={tag} className="integrations-capability">
          {tag}
        </span>
      ))}
      {extra > 0 && <span className="integrations-capability">+{extra}</span>}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: Tone;
}) {
  const iconCls =
    tone === "ok"
      ? "integrations-summary-icon integrations-summary-icon--ok"
      : tone === "sync"
        ? "integrations-summary-icon integrations-summary-icon--sync"
        : tone === "warn"
          ? "integrations-summary-icon integrations-summary-icon--warn"
          : "integrations-summary-icon integrations-summary-icon--sync";

  const icon =
    tone === "warn" ? (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
        />
      </svg>
    ) : tone === "sync" ? (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
        />
      </svg>
    ) : (
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
    );

  return (
    <div className="integrations-summary-card">
      <span className={iconCls}>{icon}</span>
      <div>
        <span className="integrations-summary-label">{label}</span>
        <div className="integrations-summary-value">{value}</div>
      </div>
    </div>
  );
}

function TableStatus({
  loading,
  syncing,
  label,
  tone,
}: {
  loading?: boolean;
  syncing?: boolean;
  label: string;
  tone?: Tone;
}) {
  const resolved = tone ?? "idle";
  if (loading) {
    return (
      <span className="integrations-table__status integrations-table__status--idle">
        <Spinner className="h-3.5 w-3.5 text-slate-400" />
        Loading
      </span>
    );
  }
  return (
    <span className={`integrations-table__status integrations-table__status--${resolved}`}>
      {syncing ? <Spinner className="h-3.5 w-3.5 text-sky-600" /> : <StatusDot tone={resolved} />}
      {label}
    </span>
  );
}

function IntegrationsTableRow({ row }: { row: IntegrationRow }) {
  const collection =
    row.lastSyncLabel != null
      ? { primary: row.lastSyncLabel, secondary: "" }
      : formatSyncDetail(row.lastSyncAt);

  return (
    <tr>
      <td>
        <div className="integrations-table__integration">
          {row.icon}
          <div className="min-w-0">
            <div className="integrations-table__name">{row.name}</div>
            {row.connected && <span className="integrations-table__badge">Connected</span>}
          </div>
        </div>
      </td>
      <td>
        <TableStatus loading={row.loading} syncing={row.syncing} label={row.healthLabel} tone={row.healthTone} />
      </td>
      <td>
        <p className="integrations-table__description">{row.description}</p>
      </td>
      <td>
        {row.loading ? (
          <span className="text-slate-400">—</span>
        ) : (
          <>
            <div className="integrations-table__collection-primary">{collection.primary}</div>
            {collection.secondary && (
              <div className="integrations-table__collection-secondary">{collection.secondary}</div>
            )}
          </>
        )}
      </td>
      <td>
        <span className="integrations-table__permissions">
          {row.permissionsVerified && <IconShield className="h-3.5 w-3.5 text-emerald-600" />}
          {row.permissionsLabel}
        </span>
      </td>
      <td>
        <CapabilityPills tags={row.capabilities} />
      </td>
      <td>
        <div className="integrations-table__actions">
          <Link to={row.href} className="integrations-manage-btn">
            {integrationCta(row.connected)}
          </Link>
          <Link to={row.href} className="integrations-chevron" aria-label={`Open ${row.name}`}>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </Link>
        </div>
      </td>
    </tr>
  );
}

function IntegrationsTable({ rows }: { rows: IntegrationRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="integrations-table-wrap px-6 py-10 text-center text-sm text-slate-500">
        No connected integrations yet. Connect AWS or a source control provider to get started.
      </div>
    );
  }

  return (
    <div className="integrations-table-wrap">
      <table className="integrations-table">
        <thead>
          <tr>
            <th>Integration</th>
            <th>Status</th>
            <th>Description</th>
            <th>Last collection</th>
            <th>Permissions</th>
            <th>Capabilities</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <IntegrationsTableRow key={row.key} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExploreIntegrationsSection({ cards }: { cards: ExploreCard[] }) {
  return (
    <section className="integrations-explore">
      <div>
        <h2>Explore more integrations</h2>
        <p className="mt-1 text-sm text-zinc-500">Optional destinations and alerts you can connect next.</p>
      </div>
      <div className="integrations-explore-grid">
        {cards.map((card) => (
          <article key={card.key} className="integrations-explore-card">
            <IntegrationBrandIcon brand={card.brand} size={48} variant="plain" className="integrations-explore-card__icon" />
            <div className="integrations-explore-card__body">
              <div className="integrations-explore-card__name">{card.name}</div>
              <p className="integrations-explore-card__desc">{card.description}</p>
            </div>
            {card.comingSoon || !card.href ? (
              <button type="button" className="integrations-connect-btn" disabled>
                Connect
              </button>
            ) : (
              <Link to={card.href} className="integrations-connect-btn">
                Connect
              </Link>
            )}
          </article>
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
      <Link to="/accounts" className="shrink-0 text-sm font-semibold text-sky-700 transition hover:text-sky-900">
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
  const googleWorkspace = useQuery({
    queryKey: ["google-workspace-provider"],
    queryFn: () => api<ProviderSummary | null>("/v1/integrations/google-workspace"),
  });
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

  const awsConnected = awsAccount?.status === "connected";
  const githubConnected = !!github.data;
  const gitlabConnected = !!gitlab.data;
  const googleConnected = !!googleWorkspace.data;
  const entraConnected = !!entra.data;

  const connectedCount = [awsConnected, githubConnected, gitlabConnected, googleConnected, entraConnected, slackConnected].filter(
    Boolean,
  ).length;
  const syncingCount = [awsScanRunning, githubSync.isSyncing, gitlabSync.isSyncing, googleWorkspaceSync.isSyncing, entraSync.isSyncing].filter(
    Boolean,
  ).length;
  const errorCount = [accounts.isError, github.isError, gitlab.isError, googleWorkspace.isError, entra.isError, settings.isError].filter(
    Boolean,
  ).length;

  const integrationRows: IntegrationRow[] = [
    {
      key: "aws",
      name: "AWS",
      description: "Posture scans, audit evidence, and automated remediation.",
      icon: <IntegrationBrandIcon brand="aws" size={48} />,
      href: "/accounts",
      connected: awsConnected,
      syncing: awsScanRunning,
      loading: accounts.isLoading,
      lastSyncAt: awsAccount?.last_scan_at ?? null,
      healthLabel: awsScanRunning ? "Scanning" : awsAccount?.last_scan_at ? "Healthy" : "Awaiting scan",
      healthTone: awsScanRunning ? "sync" : awsAccount?.last_scan_at ? "ok" : "idle",
      permissionsLabel: awsConnected ? "Connector verified" : "Not connected",
      permissionsVerified: awsConnected,
      capabilities: ["IAM", "S3", "KMS", "CloudTrail", "Remediation"],
    },
    {
      key: "github",
      name: "GitHub",
      description: "Repository controls, branch protection, pull request reviews, and change evidence.",
      icon: <IntegrationBrandIcon brand="github" size={48} />,
      href: "/integrations/github",
      connected: githubConnected,
      syncing: githubSync.isSyncing,
      loading: github.isLoading,
      lastSyncAt: github.data?.last_synced_at ?? null,
      healthLabel: githubSync.isSyncing
        ? "Syncing"
        : github.data?.status === "error"
          ? "Needs reconnect"
          : githubConnected
            ? "Healthy"
            : "Not configured",
      healthTone: githubSync.isSyncing ? "sync" : github.data?.status === "error" ? "warn" : githubConnected ? "ok" : "idle",
      permissionsLabel: githubConnected ? "OAuth connected" : "Not connected",
      permissionsVerified: githubConnected,
      capabilities: ["Branch protection", "Reviews", "Repositories"],
    },
    {
      key: "gitlab",
      name: "GitLab",
      description: "Merge-request controls, protected branches, and change-management evidence.",
      icon: <IntegrationBrandIcon brand="gitlab" size={48} />,
      href: "/integrations/gitlab",
      connected: gitlabConnected,
      syncing: gitlabSync.isSyncing,
      loading: gitlab.isLoading,
      lastSyncAt: gitlab.data?.last_synced_at ?? null,
      healthLabel: gitlabSync.isSyncing
        ? "Syncing"
        : gitlab.data?.status === "error"
          ? "Needs reconnect"
          : gitlabConnected
            ? "Healthy"
            : "Not configured",
      healthTone: gitlabSync.isSyncing ? "sync" : gitlab.data?.status === "error" ? "warn" : gitlabConnected ? "ok" : "idle",
      permissionsLabel: gitlabConnected ? "OAuth connected" : "Not connected",
      permissionsVerified: gitlabConnected,
      capabilities: ["Protected branches", "MR approvals", "Projects"],
    },
    ...(googleConnected
      ? [
          {
            key: "google-workspace",
            name: "Google Workspace",
            description: "Directory MFA, inactive users, and admin roster for CC6 evidence",
            icon: <IntegrationBrandIcon brand="google-workspace" size={48} />,
            href: "/integrations/google-workspace",
            connected: true,
            syncing: googleWorkspaceSync.isSyncing,
            loading: googleWorkspace.isLoading,
            lastSyncAt: googleWorkspace.data?.last_synced_at ?? null,
            healthLabel: googleWorkspaceSync.isSyncing ? "Syncing" : "Healthy",
            healthTone: (googleWorkspaceSync.isSyncing ? "sync" : "ok") as Tone,
            permissionsLabel: "OAuth connected",
            permissionsVerified: true,
            capabilities: ["MFA enforcement", "Inactive users", "Admin review"],
          } satisfies IntegrationRow,
        ]
      : []),
    ...(entraConnected
      ? [
          {
            key: "entra",
            name: "Microsoft Entra ID",
            description: "Graph directory read for MFA posture, stale users, and privileged roles",
            icon: <IntegrationBrandIcon brand="entra" size={48} />,
            href: "/integrations/entra",
            connected: true,
            syncing: entraSync.isSyncing,
            loading: entra.isLoading,
            lastSyncAt: entra.data?.last_synced_at ?? null,
            healthLabel: entraSync.isSyncing ? "Syncing" : "Healthy",
            healthTone: (entraSync.isSyncing ? "sync" : "ok") as Tone,
            permissionsLabel: "OAuth connected",
            permissionsVerified: true,
            capabilities: ["MFA posture", "Inactive users", "Admin review"],
          } satisfies IntegrationRow,
        ]
      : []),
    ...(slackConnected
      ? [
          {
            key: "slack",
            name: "Slack",
            description: "Scan alerts and weekly digests for your channel",
            icon: <IntegrationBrandIcon brand="slack" size={48} />,
            href: "/integrations/slack",
            connected: true,
            loading: settings.isLoading,
            lastSyncAt: null,
            lastSyncLabel: "Webhook active",
            healthLabel: "Healthy",
            healthTone: "ok" as Tone,
            permissionsLabel: "Webhook configured",
            permissionsVerified: true,
            capabilities: ["Digest", "Alerts"],
          } satisfies IntegrationRow,
        ]
      : []),
  ];

  const activeRows = integrationRows.filter((row) => row.connected || row.syncing || row.key === "aws");

  const exploreCards: ExploreCard[] = [
    ...(!slackConnected
      ? [
          {
            key: "slack",
            brand: "slack",
            name: "Slack",
            description: "Send alerts and updates",
            href: "/integrations/slack",
          } satisfies ExploreCard,
        ]
      : []),
    {
      key: "jira",
      brand: "jira",
      name: "Jira",
      description: "Sync issues and tickets",
      comingSoon: true,
    },
    {
      key: "azure-devops",
      brand: "azure-devops",
      name: "Azure DevOps",
      description: "Track work and pipelines",
      comingSoon: true,
    },
    {
      key: "datadog",
      brand: "datadog",
      name: "Datadog",
      description: "Stream metrics and events",
      comingSoon: true,
    },
  ];

  return (
    <div className="integrations-page">
      <header className="integrations-page__header flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Integrations</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            Connect and manage sources for findings, compliance mapping, and audit evidence.
          </p>
        </div>
        <NotificationsBell />
      </header>

      <div className="integrations-summary">
        <SummaryCard label="Connected" value={connectedCount} tone="ok" />
        <SummaryCard label="Syncing" value={syncingCount} tone="sync" />
        <SummaryCard label="Errors" value={errorCount} tone="warn" />
      </div>

      {awsScanRunning && <ScanProgressBanner />}

      <div className="integrations-page__body">
        <IntegrationsTable rows={activeRows} />
        <ExploreIntegrationsSection cards={exploreCards} />
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
