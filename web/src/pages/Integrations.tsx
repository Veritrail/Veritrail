import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAccountScanRun } from "../hooks/useAccountScanRun";
import { useIntegrationSyncState } from "../hooks/useIntegrationSyncState";
import {
  AwsMark,
  formatSync,
  GitHubMark,
  GitLabMark,
  IconClock,
  IconShield,
  IconSync,
  IconWebhook,
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
  group: string;
  description: string;
  icon: React.ReactNode;
  iconBg: string;
  connected?: boolean;
  syncing?: boolean;
  loading?: boolean;
  href?: string;
  cta?: string;
  comingSoon?: boolean;
  stats?: { label: string; value: string | number }[];
  status?: { label: string; value: string; tone: Tone }[];
  capabilities: string[];
};

function syncHealth(lastAt: string | null): { label: string; tone: Tone } {
  if (!lastAt) return { label: "Pending", tone: "idle" };
  const age = Date.now() - new Date(lastAt).getTime();
  if (age > 7 * 24 * 60 * 60 * 1000) return { label: "Stale", tone: "warn" };
  return { label: "Synced", tone: "ok" };
}

function StatusDot({ tone }: { tone: Tone }) {
  const cls = tone === "ok" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : tone === "sync" ? "bg-indigo-500 animate-pulse" : "bg-zinc-300";
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${cls}`} />;
}

function GoogleMark({ className = "h-5 w-5" }: { className?: string }) {
  return <span className={`${className} inline-flex items-center justify-center text-xs font-bold`}>G</span>;
}

function IntegrationCardView({ card, emphasis = false }: { card: IntegrationCard; emphasis?: boolean }) {
  const connected = !!card.connected;
  const statusLabel = card.loading ? "Loading" : card.syncing ? "Syncing" : card.comingSoon ? "Planned" : connected ? "Connected" : "Not connected";
  const statusClass = card.syncing
    ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
    : connected
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : card.comingSoon
        ? "bg-zinc-50 text-zinc-400 ring-zinc-200"
        : "bg-zinc-100 text-zinc-500 ring-zinc-200";

  return (
    <article className={`flex flex-col rounded-xl border bg-white shadow-sm shadow-zinc-950/[0.02] transition ${emphasis ? "border-zinc-300 ring-1 ring-indigo-100" : card.comingSoon ? "border-dashed border-zinc-200 opacity-75" : "border-zinc-200"}`}>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white shadow-sm ${card.iconBg}`}>{card.icon}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-zinc-950">{card.name}</h3>
                <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{card.group}</span>
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{card.description}</p>
            </div>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${statusClass}`}>
            {card.syncing && <Spinner className="h-3 w-3" />}
            {statusLabel}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          {card.capabilities.map((cap) => <span key={cap} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">{cap}</span>)}
        </div>

        {card.stats && card.stats.length > 0 && !card.comingSoon && (
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {card.stats.map((s) => <div key={s.label} className="rounded-lg border border-zinc-100 bg-zinc-50/80 px-2 py-1.5 text-center"><div className="text-base font-bold tabular-nums text-zinc-900">{s.value}</div><div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">{s.label}</div></div>)}
          </div>
        )}

        {card.status && card.status.length > 0 && !card.comingSoon && (
          <div className="mt-3 grid grid-cols-1 gap-1.5 rounded-lg border border-zinc-100 bg-zinc-50/70 p-2.5">
            {card.status.map((s) => <div key={s.label} className="flex items-center justify-between gap-2 text-xs"><span className="text-zinc-500">{s.label}</span><span className="flex items-center gap-1.5 font-medium text-zinc-800"><StatusDot tone={s.tone} />{s.value}</span></div>)}
          </div>
        )}

        {card.syncing && <div className="mt-3 flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-2.5 py-1.5 text-xs text-indigo-800"><Spinner className="h-3.5 w-3.5 shrink-0" />Collecting evidence…</div>}
      </div>
      <div className="border-t border-zinc-100 p-3">
        {card.comingSoon ? <button type="button" disabled className="flex w-full cursor-not-allowed items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-400">Coming soon</button> : card.href ? <a href={card.href} className="flex w-full items-center justify-center rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800">{card.cta ?? (connected ? "Manage" : "Connect")}</a> : null}
      </div>
    </article>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">{title}</h2>
        <p className="mt-1 text-sm text-zinc-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default function Integrations() {
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
      qc.invalidateQueries({ queryKey: ["controls"] });
      qc.invalidateQueries({ queryKey: ["findings"] });
    }
    prevScanStatus.current = scanStatus;
  }, [scanStatus, qc]);

  const ghHealth = syncHealth(github.data?.last_synced_at ?? null);
  const glHealth = syncHealth(gitlab.data?.last_synced_at ?? null);
  const slackConnected = !!settings.data?.notifications.slack_webhook_url?.trim();
  const connectedCards = [awsAccount?.status === "connected", !!github.data, !!gitlab.data, slackConnected].filter(Boolean).length;
  const showActivity = githubSync.isSyncing || gitlabSync.isSyncing || awsScanRunning;

  const activeCards: IntegrationCard[] = [
    {
      name: "Amazon Web Services",
      group: "Cloud",
      description: "Primary evidence source for IAM, S3, KMS, CloudTrail, and remediation readiness.",
      icon: <AwsMark className="h-6 w-6" />,
      iconBg: "bg-[#232F3E]",
      href: "/accounts",
      cta: awsAccount?.status === "connected" ? "Manage AWS" : "Connect AWS",
      connected: awsAccount?.status === "connected",
      syncing: awsScanRunning,
      loading: accounts.isLoading,
      capabilities: ["IAM posture", "Audit logging", "S3/KMS", "Remediation"],
      stats: awsAccount?.status === "connected" ? [{ label: "Account", value: awsAccount.account_id?.slice(-4) ?? "—" }, { label: "Checks", value: "78" }, { label: "Scans", value: awsAccount.last_scan_at ? "Active" : "Pending" }] : undefined,
      status: awsAccount ? [{ label: "Scan health", value: awsScanRunning ? "Running" : awsAccount.last_scan_at ? "Healthy" : "Awaiting scan", tone: awsScanRunning ? "sync" : awsAccount.last_scan_at ? "ok" : "idle" }, { label: "Last collection", value: formatSync(awsAccount.last_scan_at), tone: awsAccount.last_scan_at ? "ok" : "idle" }, { label: "Permissions", value: awsAccount.status === "connected" ? "Connector role" : "Not verified", tone: awsAccount.status === "connected" ? "ok" : "warn" }] : undefined,
    },
    {
      name: "GitHub",
      group: "Source control",
      description: "Repository controls, branch protection, PR reviews, and change-management evidence.",
      icon: <GitHubMark className="h-6 w-6" />,
      iconBg: "bg-zinc-950",
      href: "/integrations/github",
      connected: !!github.data,
      syncing: githubSync.isSyncing,
      loading: github.isLoading,
      capabilities: ["Repos", "Branch rules", "PR reviews", "Self-merge"],
      stats: github.data ? [{ label: "Repos", value: github.data.repos }, { label: "PRs", value: github.data.pull_requests }, { label: "Status", value: ghHealth.label }] : undefined,
      status: github.data ? [{ label: "Sync health", value: ghHealth.label, tone: ghHealth.tone }, { label: "Last collection", value: formatSync(github.data.last_synced_at), tone: github.data.last_synced_at ? "ok" : "idle" }, { label: "Permissions", value: "OAuth healthy", tone: "ok" }] : undefined,
    },
    {
      name: "GitLab",
      group: "Source control",
      description: "Group controls, protected branches, merge-request approvals, and self-merge evidence.",
      icon: <GitLabMark className="h-6 w-6" />,
      iconBg: "bg-[#e24329]",
      href: "/integrations/gitlab",
      connected: !!gitlab.data,
      syncing: gitlabSync.isSyncing,
      loading: gitlab.isLoading,
      capabilities: ["Groups", "Protected branches", "MR reviews", "Self-merge"],
      stats: gitlab.data ? [{ label: "Repos", value: gitlab.data.repos }, { label: "MRs", value: gitlab.data.pull_requests }, { label: "Status", value: glHealth.label }] : undefined,
      status: gitlab.data ? [{ label: "Sync health", value: glHealth.label, tone: glHealth.tone }, { label: "Last collection", value: formatSync(gitlab.data.last_synced_at), tone: gitlab.data.last_synced_at ? "ok" : "idle" }, { label: "Permissions", value: "OAuth healthy", tone: "ok" }] : undefined,
    },
    {
      name: "Slack",
      group: "Alerts",
      description: "Webhook delivery for weekly digest and operational scan alerts.",
      icon: <SlackMark className="h-5 w-5" />,
      iconBg: "bg-[#4A154B]",
      href: "/settings",
      cta: slackConnected ? "Manage Slack" : "Configure Slack",
      connected: slackConnected,
      loading: settings.isLoading,
      capabilities: ["Weekly digest", "Scan alerts", "Webhook"],
      status: [{ label: "Webhook", value: slackConnected ? "Active" : "Not configured", tone: slackConnected ? "ok" : "idle" }, { label: "Digest", value: settings.data?.notifications.email_digest_enabled ? "Enabled" : "Off", tone: settings.data?.notifications.email_digest_enabled ? "ok" : "idle" }],
    },
  ];

  const plannedCards: IntegrationCard[] = [
    { name: "Google Cloud", group: "Cloud", description: "Asset inventory and CIS/GCP control mapping.", icon: <GoogleMark className="h-5 w-5" />, iconBg: "bg-zinc-400", comingSoon: true, capabilities: ["IAM", "GCS", "Audit logs"] },
    { name: "Microsoft Azure", group: "Cloud", description: "Entra ID, storage, policy, and Defender evidence.", icon: <span className="text-xs font-bold">Az</span>, iconBg: "bg-zinc-400", comingSoon: true, capabilities: ["Entra", "Storage", "Defender"] },
    { name: "Okta", group: "Identity", description: "SSO assignments, group membership, and MFA posture.", icon: <IconShield className="h-5 w-5" />, iconBg: "bg-zinc-400", comingSoon: true, capabilities: ["SSO", "Groups", "MFA"] },
    { name: "PagerDuty", group: "Alerts", description: "Incident routing for critical scan failures and regressions.", icon: <IconWebhook className="h-5 w-5" />, iconBg: "bg-zinc-400", comingSoon: true, capabilities: ["Routing", "On-call", "Escalation"] },
  ];

  return (
    <div className="w-full max-w-5xl space-y-5 pb-10">
      <header className="rounded-2xl border border-zinc-200 bg-white shadow-sm shadow-zinc-950/[0.03]">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-100 bg-gradient-to-br from-zinc-50 via-white to-indigo-50/30 px-4 py-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-500">Evidence fabric</p>
            <h1 className="mt-0.5 text-xl font-bold tracking-tight text-zinc-950">Integrations</h1>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /><span className="font-semibold text-zinc-700">{connectedCards}</span><span className="text-zinc-400">active</span></span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-500" /><span className="font-semibold text-zinc-700">{[awsAccount?.status === "connected", !!github.data, !!gitlab.data].filter(Boolean).length}</span><span className="text-zinc-400">sources</span></span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-indigo-500" /><span className="font-semibold text-zinc-700">{slackConnected ? 1 : 0}</span><span className="text-zinc-400">alert</span></span>
          </div>
        </div>
        {showActivity && <div className="bg-indigo-50/80 px-4 py-2 text-xs text-indigo-800"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><Spinner className="h-3.5 w-3.5 shrink-0 text-indigo-500" /><span className="font-semibold">{[githubSync.isSyncing && "GitHub sync", gitlabSync.isSyncing && "GitLab sync", awsScanRunning && "AWS scan"].filter(Boolean).join(" · ")} in progress</span><span className="text-indigo-600/75">findings refresh when complete</span></div></div>}
      </header>

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-400">Active integrations</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Connected systems and the evidence they feed into Vigil.</p>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">{activeCards.map((card) => <IntegrationCardView key={card.name} card={card} emphasis={!!card.connected} />)}</div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-400">Planned integrations</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Future evidence sources. Will activate when ready.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {plannedCards.map((card) => (
            <div key={card.name} className="flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 shadow-sm shadow-zinc-950/[0.02]">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm ${card.iconBg}`}>{card.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-800">{card.name}</p>
                <p className="text-[11px] text-zinc-500">{card.description}</p>
              </div>
              <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Planned</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
