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

function integrationCta(connected: boolean): string {
  return connected ? "Manage" : "Connect";
}

function integrationStatus(card: IntegrationCard): { label: string; tone: Tone } {
  if (card.loading) return { label: "Loading", tone: "idle" };
  if (card.syncing) return { label: "Syncing", tone: "sync" };
  if (card.connected) return { label: "Connected", tone: "ok" };
  return { label: "Not connected", tone: "idle" };
}

function CardTitleRow({
  name,
  status,
  suffix,
  size = "lg",
}: {
  name: string;
  status: { label: string; tone: Tone };
  suffix?: React.ReactNode;
  size?: "lg" | "sm";
}) {
  const Title = size === "lg" ? "h2" : "h3";
  const titleCls = size === "lg" ? "text-base font-bold text-zinc-950" : "text-sm font-bold text-zinc-950";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Title className={titleCls}>{name}</Title>
      <StatusPill label={status.label} tone={status.tone} />
      {suffix}
    </div>
  );
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
  const rows: { label: string; value: string }[] = [
    { label: 'Last collection', value: card.lastSync },
    { label: 'Sync', value: card.healthLabel },
    { label: 'Permissions', value: card.permissionsLabel },
  ];
  return (
    <div className="mt-3 space-y-1 border-t border-zinc-100 pt-3 text-[11px] leading-snug">
      {rows.map(({ label, value }) => (
        <p key={label}>
          <span className="text-zinc-500">{label}:</span>{' '}
          <span className="font-medium text-zinc-800">{value}</span>
        </p>
      ))}
    </div>
  );
}

function EvidenceChips({ types }: { types: string[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1">
      {types.map((t) => (
        <span key={t} className="rounded border border-zinc-200/80 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
          {t}
        </span>
      ))}
    </div>
  );
}

function IntegrationAction({ href, label }: { href: string; label: string }) {
  return (
    <Link
      to={href}
      className="inline-flex items-center rounded-md px-2.5 py-1.5 text-xs font-semibold text-zinc-600 ring-1 ring-inset ring-zinc-200/90 transition hover:bg-zinc-50 hover:text-zinc-900"
    >
      {label}
    </Link>
  );
}

function IntegrationCardFooter({
  href,
  label,
  className = "",
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={`mt-3 border-t border-zinc-100 pt-2.5 ${className}`}>
      <IntegrationAction href={href} label={label} />
    </div>
  );
}

function IntegrationCard({ card, primary = false }: { card: IntegrationCard; primary?: boolean }) {
  const status = integrationStatus(card);

  return (
    <article
      className={`flex h-full flex-col rounded-lg border border-zinc-200 bg-white ${primary ? "p-4 sm:p-5" : "p-4"}`}
    >
      <div className={`flex items-start ${primary ? "gap-3 sm:gap-4" : "gap-3"}`}>
        <span
          className={`flex shrink-0 items-center justify-center text-white ${card.iconBg} ${
            primary ? "h-11 w-11 rounded-lg" : "h-8 w-8 rounded-md"
          }`}
        >
          {card.icon}
        </span>
        <div className="min-w-0 flex-1">
          <CardTitleRow
            name={card.name}
            status={status}
            size={primary ? "lg" : "sm"}
            suffix={
              primary ? (
                <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Primary source</span>
              ) : undefined
            }
          />
          <p
            className={
              primary
                ? "mt-1 text-sm text-zinc-600"
                : "mt-1 line-clamp-2 text-[11px] leading-snug text-zinc-600"
            }
          >
            {card.valueProp}
          </p>
        </div>
      </div>
      <HealthRows card={card} />
      <EvidenceChips types={card.evidenceTypes} />
      <IntegrationCardFooter href={card.href} label={card.cta} className="mt-auto" />
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
    valueProp: "Read-only AWS posture scans mapped to SOC 2, CIS, and ISO controls, plus evidence packs.",
    icon: <AwsMark className="h-6 w-6" />,
    iconBg: "bg-[#232F3E]",
    href: "/accounts",
    cta: integrationCta(awsAccount?.status === "connected"),
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
      cta: integrationCta(!!github.data),
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
      cta: integrationCta(!!gitlab.data),
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
      cta: integrationCta(slackConnected),
      connected: slackConnected,
      loading: settings.isLoading,
      evidenceTypes: ["Digest", "Alerts"],
      lastSync: slackConnected ? "Webhook active" : "—",
      healthLabel: slackConnected ? "Healthy" : "Not configured",
      permissionsLabel: slackConnected ? "Webhook configured" : "Not configured",
    },
  ];

  return (
    <PageShell
      variant="compact"
      eyebrow="CONNECTED SOURCES"
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

      <IntegrationCard card={awsCard} primary />

      <div className="grid gap-3 sm:grid-cols-2">
        {secondary.map((card) => (
          <IntegrationCard key={card.name} card={card} />
        ))}
      </div>
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
