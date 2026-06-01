import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { PageShell } from "../components/PageShell";
import { ProductShell } from "../components/ProductShell";
import { useAccountScanRun } from "../hooks/useAccountScanRun";
import { useIntegrationSyncState } from "../hooks/useIntegrationSyncState";
import {
  AwsMark,
  formatSync,
  GitHubMark,
  GitLabMark,
  SlackMark,
  Spinner,
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
  icon: React.ReactNode;
  iconBg: string;
  connected?: boolean;
  syncing?: boolean;
  loading?: boolean;
  href: string;
  cta: string;
  evidenceTypes: string[];
  lastSync: string;
  permissionsLabel: string;
  healthLabel: string;
};

function syncHealth(lastAt: string | null): { label: string; tone: Tone } {
  if (!lastAt) return { label: "Pending", tone: "idle" };
  const age = Date.now() - new Date(lastAt).getTime();
  if (age > 7 * 24 * 60 * 60 * 1000) return { label: "Stale", tone: "warn" };
  return { label: "Healthy", tone: "ok" };
}

function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  const cls =
    tone === "ok"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : tone === "sync"
          ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
          : "bg-zinc-100 text-zinc-500 ring-zinc-200";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${cls}`}
    >
      {tone === "sync" && <Spinner className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

function HealthRows({ card }: { card: IntegrationCard }) {
  return (
    <div className="mt-2 space-y-0.5 text-[11px]">
      <div className="flex justify-between gap-2">
        <span className="text-zinc-500">Last collection</span>
        <span className="font-medium text-zinc-800">{card.lastSync}</span>
      </div>
      <div className="flex justify-between gap-2">
        <span className="text-zinc-500">Sync</span>
        <span className="font-medium text-zinc-800">{card.healthLabel}</span>
      </div>
      <div className="flex justify-between gap-2">
        <span className="text-zinc-500">Permissions</span>
        <span className="truncate font-medium text-zinc-800">{card.permissionsLabel}</span>
      </div>
    </div>
  );
}

function EvidenceChips({ types }: { types: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {types.map((t) => (
        <span key={t} className="rounded border border-zinc-200/80 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
          {t}
        </span>
      ))}
    </div>
  );
}

function AwsPrimaryCard({ card }: { card: IntegrationCard }) {
  const statusLabel = card.loading ? "Loading" : card.syncing ? "Syncing" : card.connected ? "Connected" : "Not connected";
  const statusTone: Tone = card.syncing ? "sync" : card.connected ? "ok" : "idle";

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 gap-3">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white ${card.iconBg}`}>
            {card.icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-zinc-950">{card.name}</h2>
              <StatusPill label={statusLabel} tone={statusTone} />
              <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Primary source</span>
            </div>
            <p className="mt-1 text-sm text-zinc-600">{card.valueProp}</p>
            <HealthRows card={card} />
            <EvidenceChips types={card.evidenceTypes} />
          </div>
        </div>
        <Link
          to={card.href}
          className="inline-flex shrink-0 items-center justify-center self-start rounded-lg bg-zinc-950 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 sm:mt-1"
        >
          {card.cta}
        </Link>
      </div>
    </article>
  );
}

function SecondaryIntegrationCard({ card }: { card: IntegrationCard }) {
  const statusLabel = card.loading ? "Loading" : card.syncing ? "Syncing" : card.connected ? "Connected" : "Not connected";
  const statusTone: Tone = card.syncing ? "sync" : card.connected ? "ok" : "idle";

  return (
    <article className="flex h-full flex-col rounded-lg border border-zinc-200 bg-white p-3.5">
      <div className="flex items-start gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white ${card.iconBg}`}>
          {card.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-bold text-zinc-950">{card.name}</h3>
            <StatusPill label={statusLabel} tone={statusTone} />
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-600">{card.valueProp}</p>
        </div>
      </div>
      <HealthRows card={card} />
      <EvidenceChips types={card.evidenceTypes} />
      <div className="mt-3 border-t border-zinc-100 pt-2.5">
        <Link
          to={card.href}
          className="inline-flex rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50"
        >
          {card.cta}
        </Link>
      </div>
    </article>
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

  const ghHealth = syncHealth(github.data?.last_synced_at ?? null);
  const glHealth = syncHealth(gitlab.data?.last_synced_at ?? null);
  const slackConnected = !!settings.data?.notifications.slack_webhook_url?.trim();
  const connectedCount = [awsAccount?.status === "connected", !!github.data, !!gitlab.data, slackConnected].filter(
    Boolean,
  ).length;
  const showActivity = githubSync.isSyncing || gitlabSync.isSyncing || awsScanRunning;

  const awsCard: IntegrationCard = {
    name: "AWS",
    valueProp: "Core cloud evidence for posture, controls, and automated remediation.",
    icon: <AwsMark className="h-6 w-6" />,
    iconBg: "bg-[#232F3E]",
    href: "/accounts",
    cta: awsAccount?.status === "connected" ? "Manage AWS" : "Connect AWS",
    connected: awsAccount?.status === "connected",
    syncing: awsScanRunning,
    loading: accounts.isLoading,
    evidenceTypes: ["IAM", "S3", "KMS", "CloudTrail", "Remediation"],
    lastSync: formatSync(awsAccount?.last_scan_at ?? null) || "—",
    healthLabel: awsScanRunning ? "Scan running" : awsAccount?.last_scan_at ? "Healthy" : "Awaiting scan",
    permissionsLabel: awsAccount?.status === "connected" ? "Connector verified" : "Not connected",
  };

  const secondary: IntegrationCard[] = [
    {
      name: "GitHub",
      valueProp: "Change-management evidence from repos and branch protection.",
      icon: <GitHubMark className="h-4 w-4" />,
      iconBg: "bg-zinc-950",
      href: "/integrations/github",
      cta: github.data ? "Manage" : "Connect",
      connected: !!github.data,
      syncing: githubSync.isSyncing,
      loading: github.isLoading,
      evidenceTypes: ["Branch protection", "Reviews"],
      lastSync: formatSync(github.data?.last_synced_at ?? null) || "—",
      healthLabel: ghHealth.label,
      permissionsLabel: github.data ? "OAuth connected" : "Not connected",
    },
    {
      name: "GitLab",
      valueProp: "Group and project policy evidence for merge requests.",
      icon: <GitLabMark className="h-4 w-4" />,
      iconBg: "bg-[#e24329]",
      href: "/integrations/gitlab",
      cta: gitlab.data ? "Manage" : "Connect",
      connected: !!gitlab.data,
      syncing: gitlabSync.isSyncing,
      loading: gitlab.isLoading,
      evidenceTypes: ["Protected branches", "MR approvals"],
      lastSync: formatSync(gitlab.data?.last_synced_at ?? null) || "—",
      healthLabel: glHealth.label,
      permissionsLabel: gitlab.data ? "OAuth connected" : "Not connected",
    },
    {
      name: "Slack",
      valueProp: "Weekly digests and scan-failure alerts to your channel.",
      icon: <SlackMark className="h-3.5 w-3.5" />,
      iconBg: "bg-[#4A154B]",
      href: "/settings",
      cta: slackConnected ? "Manage" : "Configure",
      connected: slackConnected,
      loading: settings.isLoading,
      evidenceTypes: ["Digest", "Alerts"],
      lastSync: slackConnected ? "Webhook active" : "—",
      healthLabel: slackConnected ? "Healthy" : "Not configured",
      permissionsLabel: slackConnected ? "Webhook configured" : "Not configured",
    },
  ];

  const planned = ["Google Cloud", "Microsoft Azure", "Okta", "PagerDuty"];

  return (
    <PageShell
      variant="compact"
      eyebrow="EVIDENCE FABRIC"
      title="Integrations"
      description="Connected sources that feed findings, compliance mapping, and audit evidence."
      actions={
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
          {connectedCount} connected
        </span>
      }
      width="w-full"
    >
      {showActivity && (
        <div className="flex items-center gap-2 rounded-lg border border-indigo-200/80 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-900">
          <Spinner className="h-3.5 w-3.5 shrink-0" />
          <span>
            {[githubSync.isSyncing && "GitHub", gitlabSync.isSyncing && "GitLab", awsScanRunning && "AWS scan"]
              .filter(Boolean)
              .join(" · ")}{" "}
            in progress
          </span>
        </div>
      )}

      <AwsPrimaryCard card={awsCard} />

      <div className="grid gap-3 sm:grid-cols-2">
        {secondary.map((card) => (
          <SecondaryIntegrationCard key={card.name} card={card} />
        ))}
      </div>

      <p className="border-t border-dashed border-zinc-200 pt-3 text-xs text-zinc-500">
        <span className="font-semibold text-zinc-400">Planned: </span>
        {planned.join(", ")}
      </p>
    </PageShell>
  );
}

export default function Integrations() {
  return (
    <ProductShell>
      <IntegrationsContent />
    </ProductShell>
  );
}
