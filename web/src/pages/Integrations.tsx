import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { PageShell } from "../components/PageShell";
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

function HealthRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5 text-[11px]">
      <span className="text-zinc-500">{label}</span>
      <span className="truncate font-medium text-zinc-800">{value}</span>
    </div>
  );
}

function IntegrationCardView({ card }: { card: IntegrationCard }) {
  const statusLabel = card.loading ? "Loading" : card.syncing ? "Syncing" : card.connected ? "Connected" : "Not connected";
  const statusTone: Tone = card.syncing ? "sync" : card.connected ? "ok" : "idle";

  return (
    <article className="flex flex-col rounded-xl border border-zinc-200 bg-white shadow-sm shadow-zinc-950/[0.02]">
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white shadow-sm ${card.iconBg}`}
          >
            {card.icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-bold text-zinc-950">{card.name}</h3>
              <StatusPill label={statusLabel} tone={statusTone} />
            </div>
            <p className="mt-1 text-xs leading-snug text-zinc-600">{card.valueProp}</p>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-zinc-100 bg-zinc-50/80 px-2.5 py-1.5">
          <HealthRow label="Last collection" value={card.lastSync} />
          <HealthRow label="Sync health" value={card.healthLabel} />
          <HealthRow label="Permissions" value={card.permissionsLabel} />
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1">
          {card.evidenceTypes.map((t) => (
            <span
              key={t}
              className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 ring-1 ring-zinc-200/60"
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="border-t border-zinc-100 px-3 py-2.5">
        <Link
          to={card.href}
          className="flex w-full items-center justify-center rounded-lg bg-zinc-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800"
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

  const cards: IntegrationCard[] = [
    {
      name: "AWS",
      valueProp: "Primary cloud evidence for posture, controls, and automated remediation.",
      icon: <AwsMark className="h-5 w-5" />,
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
    },
    {
      name: "GitHub",
      valueProp: "Change-management evidence from repos, branch protection, and reviews.",
      icon: <GitHubMark className="h-5 w-5" />,
      iconBg: "bg-zinc-950",
      href: "/integrations/github",
      cta: github.data ? "Manage GitHub" : "Connect GitHub",
      connected: !!github.data,
      syncing: githubSync.isSyncing,
      loading: github.isLoading,
      evidenceTypes: ["Branch protection", "Reviews", "CODEOWNERS"],
      lastSync: formatSync(github.data?.last_synced_at ?? null) || "—",
      healthLabel: ghHealth.label,
      permissionsLabel: github.data ? "OAuth connected" : "Not connected",
    },
    {
      name: "GitLab",
      valueProp: "Group and project policy evidence for merge requests and protected branches.",
      icon: <GitLabMark className="h-5 w-5" />,
      iconBg: "bg-[#e24329]",
      href: "/integrations/gitlab",
      cta: gitlab.data ? "Manage GitLab" : "Connect GitLab",
      connected: !!gitlab.data,
      syncing: gitlabSync.isSyncing,
      loading: gitlab.isLoading,
      evidenceTypes: ["Protected branches", "MR approvals", "Self-merge"],
      lastSync: formatSync(gitlab.data?.last_synced_at ?? null) || "—",
      healthLabel: glHealth.label,
      permissionsLabel: gitlab.data ? "OAuth connected" : "Not connected",
    },
    {
      name: "Slack",
      valueProp: "Delivers weekly digests and scan-failure alerts to your team channel.",
      icon: <SlackMark className="h-4 w-4" />,
      iconBg: "bg-[#4A154B]",
      href: "/settings",
      cta: slackConnected ? "Manage delivery" : "Configure Slack",
      connected: slackConnected,
      loading: settings.isLoading,
      evidenceTypes: ["Digest", "Scan alerts"],
      lastSync: slackConnected ? "Webhook active" : "—",
      healthLabel: slackConnected ? "Healthy" : "Not configured",
      permissionsLabel: slackConnected ? "Webhook configured" : "Not configured",
    },
  ];

  const planned = ["Google Cloud", "Microsoft Azure", "Okta", "PagerDuty"];

  return (
    <PageShell
      eyebrow="Evidence fabric"
      title="Integrations"
      description="Connected evidence sources and their collection health."
      actions={
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
          {connectedCount} connected
        </span>
      }
      width="w-full"
    >
      {showActivity && (
        <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/80 px-3 py-2 text-xs text-indigo-900">
          <Spinner className="h-3.5 w-3.5 shrink-0" />
          <span>
            {[githubSync.isSyncing && "GitHub", gitlabSync.isSyncing && "GitLab", awsScanRunning && "AWS scan"]
              .filter(Boolean)
              .join(" · ")}{" "}
            in progress
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <IntegrationCardView key={card.name} card={card} />
        ))}
      </div>

      <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50 px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Planned</span>
          {planned.map((name) => (
            <span key={name} className="text-xs text-zinc-500">
              {name}
            </span>
          ))}
        </div>
      </div>
    </PageShell>
  );
}

export default function Integrations() {
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1120px]">
      <IntegrationsContent />
    </div>
  );
}
