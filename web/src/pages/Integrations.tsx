import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { ProductShell } from "../components/ProductShell";
import { PostureMetricCell } from "./Workspace";

// d-path icons for the Workspace-style KPI strip.
const IK = {
  connected: "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  syncing: "M16.02 9.35h4.16V5.19M20.18 9.35A8.25 8.25 0 0 0 5.82 6.3M7.98 14.65H3.82v4.16M3.82 14.65a8.25 8.25 0 0 0 14.36 3.05",
  errors: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z",
  sources: "M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 8.25V6Zm0 9.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25Zm9.75-9.75A2.25 2.25 0 0 1 15.75 3.75H18A2.25 2.25 0 0 1 20.25 6v2.25a2.25 2.25 0 0 1-2.25 2.25h-2.25a2.25 2.25 0 0 1-2.25-2.25V6Zm0 9.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z",
} as const;
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
import "../styles/workspace-page.css";

type ProviderSummary = {
  id: string;
  status: string;
  last_synced_at: string | null;
  repos: number;
  pull_requests: number;
};

type ScannerIntegrationRow = {
  connected: boolean;
  status: string;
  vendor: string;
  config: { last_synced_at?: string | null; open_findings_count?: number };
};

type CloudAccountRow = {
  provider: string;
  id: string;
  external_id: string | null;
  label: string;
  status: string;
  last_scan_at: string | null;
};

type SettingsSlice = {
  notifications: {
    slack_webhook_url: string | null;
    email_digest_enabled: boolean;
  };
};

type Tone = "ok" | "warn" | "idle" | "sync" | "danger";

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
      <div className="integrations-explore__header">
        <h2>Explore more integrations</h2>
      </div>
      <div className="integrations-explore-grid">
        {cards.map((card) => {
          const isComingSoon = card.comingSoon || !card.href;
          return (
            <article
              key={card.key}
              className={`integrations-explore-card${isComingSoon ? " integrations-explore-card--coming-soon" : ""}`}
            >
              <IntegrationBrandIcon brand={card.brand} size={48} variant="plain" className="integrations-explore-card__icon" />
              <div className="integrations-explore-card__body">
                <div className="integrations-explore-card__name">{card.name}</div>
                <p className="integrations-explore-card__desc">{card.description}</p>
              </div>
              {isComingSoon ? (
                <button type="button" className="integrations-connect-btn integrations-connect-btn--coming-soon" disabled>
                  Coming soon
                </button>
              ) : (
                <Link to={card.href!} className="integrations-connect-btn">
                  Connect
                </Link>
              )}
            </article>
          );
        })}
      </div>
      <p className="integrations-explore-footer">Optional destinations and alerts you can connect next.</p>
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
  const cloudAccounts = useQuery({
    queryKey: ["cloud-accounts"],
    queryFn: () => api<CloudAccountRow[]>("/v1/integrations/cloud-accounts"),
  });
  const wizScanner = useQuery({ queryKey: ["scanner-wiz"], queryFn: () => api<ScannerIntegrationRow>("/v1/integrations/scanners/wiz") });
  const tenableScanner = useQuery({ queryKey: ["scanner-tenable"], queryFn: () => api<ScannerIntegrationRow>("/v1/integrations/scanners/tenable") });
  const qualysScanner = useQuery({ queryKey: ["scanner-qualys"], queryFn: () => api<ScannerIntegrationRow>("/v1/integrations/scanners/qualys") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<SettingsSlice>("/v1/settings") });

  const accountsList = cloudAccounts.data ?? [];
  const awsRows = accountsList.filter((a) => a.provider === "aws");
  const gcpRows = accountsList.filter((a) => a.provider === "gcp");
  const azureRows = accountsList.filter((a) => a.provider === "azure");
  const awsAccount = awsRows.find((a) => a.status === "connected") ?? awsRows[0];
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

  const gcpConnected = gcpRows.some((p) => p.status === "connected");
  const gcpProject = gcpRows.find((p) => p.status === "connected") ?? gcpRows[0];
  const azureConnected = azureRows.some((s) => s.status === "connected");
  const azureSub = azureRows.find((s) => s.status === "connected") ?? azureRows[0];
  const scannerConnected = [wizScanner.data, tenableScanner.data, qualysScanner.data].some((s) => s?.connected);
  const activeScanner = [wizScanner.data, tenableScanner.data, qualysScanner.data].find((s) => s?.connected);

  const awsConnected = awsAccount?.status === "connected";
  const cloudConnectedCount = accountsList.filter((a) => a.status === "connected").length;
  const githubConnected = !!github.data;
  const gitlabConnected = !!gitlab.data;
  const googleConnected = !!googleWorkspace.data;
  const entraConnected = !!entra.data;

  const connectedCount = [awsConnected, githubConnected, gitlabConnected, googleConnected, entraConnected, slackConnected, gcpConnected, azureConnected, scannerConnected].filter(
    Boolean,
  ).length;
  const syncingCount = [awsScanRunning, githubSync.isSyncing, gitlabSync.isSyncing, googleWorkspaceSync.isSyncing, entraSync.isSyncing].filter(
    Boolean,
  ).length;
  const errorCount = [
    cloudAccounts.isError,
    github.isError,
    gitlab.isError,
    googleWorkspace.isError,
    entra.isError,
    settings.isError,
    // A connected provider whose token/webhook broke ("Needs reconnect") is a
    // real error, not a soft warning — surface it in the Errors KPI.
    github.data?.status === "error",
    gitlab.data?.status === "error",
  ].filter(Boolean).length;

  const integrationRows: IntegrationRow[] = [
    {
      key: "aws",
      name: "AWS",
      description: "Cloud posture, audit evidence, and automated remediation across connected accounts.",
      icon: <IntegrationBrandIcon brand="aws" size={48} />,
      href: "/accounts",
      connected: awsConnected,
      syncing: awsScanRunning,
      loading: cloudAccounts.isLoading,
      lastSyncAt: awsAccount?.last_scan_at ?? null,
      healthLabel: awsScanRunning ? "Scanning" : awsAccount?.last_scan_at ? "Healthy" : "Awaiting scan",
      healthTone: awsScanRunning ? "sync" : awsAccount?.last_scan_at ? "ok" : "idle",
      permissionsLabel: awsConnected ? "Connector verified" : "Not connected",
      permissionsVerified: awsConnected,
      capabilities: ["Cloud posture", "Audit evidence", "Remediation"],
    },
    {
      key: "github",
      name: "GitHub",
      description: "Repository governance, branch protection, review evidence, and change history.",
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
      healthTone: githubSync.isSyncing ? "sync" : github.data?.status === "error" ? "danger" : githubConnected ? "ok" : "idle",
      permissionsLabel: githubConnected ? "OAuth connected" : "Not connected",
      permissionsVerified: githubConnected,
      capabilities: ["Repositories", "Branch protection", "Review evidence"],
    },
    {
      key: "gitlab",
      name: "GitLab",
      description: "Repository governance, branch protection, review evidence, and change history.",
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
      healthTone: gitlabSync.isSyncing ? "sync" : gitlab.data?.status === "error" ? "danger" : gitlabConnected ? "ok" : "idle",
      permissionsLabel: gitlabConnected ? "OAuth connected" : "Not connected",
      permissionsVerified: gitlabConnected,
      capabilities: ["Repositories", "Branch protection", "Review evidence"],
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
    ...(gcpConnected
      ? [
          {
            key: "gcp",
            name: "Google Cloud",
            description: "Cloud posture, audit evidence, and security findings across connected projects.",
            icon: <IntegrationBrandIcon brand="gcp" size={48} />,
            href: "/integrations/gcp",
            connected: true,
            loading: cloudAccounts.isLoading,
            lastSyncAt: gcpProject?.last_scan_at ?? null,
            healthLabel: gcpProject?.last_scan_at ? "Healthy" : "Awaiting scan",
            healthTone: (gcpProject?.last_scan_at ? "ok" : "idle") as Tone,
            permissionsLabel: "Service account verified",
            permissionsVerified: true,
            capabilities: ["Cloud posture", "Audit evidence", "Findings"],
          } satisfies IntegrationRow,
        ]
      : []),
    ...(azureConnected
      ? [
          {
            key: "azure",
            name: "Microsoft Azure",
            description: "Defender for Cloud and storage public access checks",
            icon: <IntegrationBrandIcon brand="azure" size={48} />,
            href: "/integrations/azure",
            connected: true,
            loading: cloudAccounts.isLoading,
            lastSyncAt: azureSub?.last_scan_at ?? null,
            healthLabel: azureSub?.last_scan_at ? "Healthy" : "Awaiting scan",
            healthTone: (azureSub?.last_scan_at ? "ok" : "idle") as Tone,
            permissionsLabel: "Client credentials verified",
            permissionsVerified: true,
            capabilities: ["Defender", "Storage", "Findings"],
          } satisfies IntegrationRow,
        ]
      : []),
    ...(scannerConnected && activeScanner
      ? [
          {
            key: `scanner-${activeScanner.vendor}`,
            name: `${activeScanner.vendor.charAt(0).toUpperCase()}${activeScanner.vendor.slice(1)} scanner`,
            description: "External vulnerability scanner summary sync",
            icon: <IntegrationBrandIcon brand={activeScanner.vendor as IntegrationBrandId} size={48} />,
            href: `/integrations/scanners/${activeScanner.vendor}`,
            connected: true,
            loading: false,
            lastSyncAt: activeScanner.config.last_synced_at ?? null,
            healthLabel: "Healthy",
            healthTone: "ok" as Tone,
            permissionsLabel: "API connected",
            permissionsVerified: true,
            capabilities: ["Vuln summary", "Sync"],
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
    ...(!gcpConnected
      ? [
          {
            key: "gcp-explore",
            brand: "gcp",
            name: "Google Cloud",
            description: "Multi-cloud posture checks",
            href: "/integrations/gcp",
          } satisfies ExploreCard,
        ]
      : []),
    ...(!azureConnected
      ? [
          {
            key: "azure-explore",
            brand: "azure",
            name: "Microsoft Azure",
            description: "Defender and storage checks",
            href: "/integrations/azure",
          } satisfies ExploreCard,
        ]
      : []),
    {
      key: "jira",
      brand: "jira",
      name: "Jira",
      description: "Sync issues and tickets",
      href: "/integrations/jira",
    },
    {
      key: "azure-devops",
      brand: "azure-devops",
      name: "Azure DevOps",
      description: "Track work and pipelines",
      comingSoon: true,
    },
  ];

  return (
    <div className="integrations-page">
      <div className="workspace-summary workspace-summary--metrics">
        <PostureMetricCell icon={IK.connected} label="Connected" value={String(connectedCount)} detail="Active connectors" valueTone="ok" />
        <PostureMetricCell icon={IK.syncing} label="Syncing" value={String(syncingCount)} detail={syncingCount ? "In progress" : "Idle"} valueTone={syncingCount ? "info" : "default"} />
        <PostureMetricCell icon={IK.errors} label="Errors" value={String(errorCount)} detail={errorCount ? "Need attention" : "None"} valueTone={errorCount ? "warn" : "default"} />
        <PostureMetricCell icon={IK.sources} label="Cloud accounts" value={String(cloudConnectedCount)} detail={`${accountsList.length} configured`} />
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
    <ProductShell className="flex flex-1 flex-col">
      <IntegrationsContent />
    </ProductShell>
  );
}
