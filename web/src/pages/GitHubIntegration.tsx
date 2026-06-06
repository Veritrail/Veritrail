import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import {
  formatSync,
  GitHubMark,
  IconBranch,
  IconShield,
  IconSync,
  IconUsers,
  ProgressBar,
  Spinner,
  StatusDot,
} from "../components/IntegrationsUi";
import { GITHUB_SYNC_KEY, useIntegrationSyncState } from "../hooks/useIntegrationSyncState";
import { useAccountScanRun } from "../hooks/useAccountScanRun";

type GitHubProvider = {
  id: string;
  status: string;
  login: string | null;
  org_login: string | null;
  org_logins: string[];
  last_synced_at: string | null;
  identity_users: number;
  repos: number;
  protected_branches: number;
  pull_requests: number;
  selected_repos: string[];
};

type SyncStats = {
  identity_users: number;
  repos: number;
  repo_protections: number;
  pull_requests: number;
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

const EVIDENCE_TYPES = [
  { key: "identity", label: "Access reviews" },
  { key: "pr", label: "PR approvals" },
  { key: "merge", label: "Self-merge checks" },
  { key: "branch", label: "Branch protections" },
] as const;

type HealthTone = "ok" | "warn" | "idle" | "sync";

function HealthStrip({
  items,
}: {
  items: { label: string; value: string; tone: HealthTone }[];
}) {
  const railClass: Record<HealthTone, string> = {
    ok: "bg-emerald-400",
    sync: "bg-indigo-400",
    warn: "bg-amber-400",
    idle: "bg-slate-300",
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="relative overflow-hidden rounded-xl border border-zinc-200/90 bg-white px-4 py-3.5 shadow-sm shadow-zinc-950/[0.025]"
        >
          <span className={`absolute inset-y-3 left-0 w-0.5 rounded-r-full ${railClass[item.tone]}`} />
          <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{item.label}</span>
          <span className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-950">
            <StatusDot tone={item.tone} />
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function PanelCard({
  title,
  description,
  children,
  accent,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  accent?: "warn" | "ok" | "none";
}) {
  const accentCls =
    accent === "warn"
      ? "border-l-[3px] border-l-amber-400"
      : accent === "ok"
        ? "border-l-[3px] border-l-emerald-400"
        : "";

  return (
    <section
      className={`rounded-xl border border-zinc-200/90 bg-white p-5 shadow-sm shadow-zinc-950/[0.035] ${accentCls}`}
    >
      <div className="mb-4">
        <h3 className="text-sm font-bold text-zinc-950">{title}</h3>
        {description && <p className="mt-1 text-xs leading-relaxed text-zinc-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function panelAccentCls(accent?: "warn" | "ok" | "none") {
  if (accent === "warn") return "border-l-[3px] border-l-amber-400";
  if (accent === "ok") return "border-l-[3px] border-l-emerald-400";
  return "";
}

const HEADER_ACTION_BTN =
  "inline-flex h-9 items-center justify-center rounded-[9px] px-4 text-[13px] font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60";

const CARD_ACTION_LINK =
  "inline-flex items-center gap-1.5 text-[13px] font-semibold text-zinc-800 transition hover:text-zinc-950";

function ArrowIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
  );
}

function EvidenceStatusPill({ status }: { status: "collected" | "review" | "pending" }) {
  const cls =
    status === "collected"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : status === "review"
        ? "bg-amber-50 text-amber-800 ring-amber-200"
        : "bg-zinc-100 text-zinc-500 ring-zinc-200";
  const label = status === "collected" ? "Collected" : status === "review" ? "Needs review" : "Pending";

  return (
    <span className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${cls}`}>
      {label}
    </span>
  );
}

function ProtectionStatusPill({ status }: { status: "review" | "protected" | "pending" }) {
  const cls =
    status === "review"
      ? "border border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]"
      : status === "protected"
        ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border border-zinc-200 bg-zinc-100 text-zinc-500";
  const label = status === "review" ? "Needs review" : status === "protected" ? "Protected" : "Pending";

  return <span className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>;
}

function ChecklistIcon({ status }: { status: "collected" | "review" | "pending" }) {
  const cls =
    status === "collected"
      ? "bg-emerald-50 text-emerald-600 ring-emerald-200"
      : status === "review"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : "bg-zinc-100 text-zinc-400 ring-zinc-200";

  return (
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ${cls}`}>
      {status === "review" ? (
        <span className="text-xs font-bold">!</span>
      ) : status === "collected" ? (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />
      )}
    </span>
  );
}

function ActivityMetric({ icon: Icon, label, value }: { icon: typeof IconUsers; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-100 bg-zinc-50/70 px-3.5 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-zinc-500 ring-1 ring-zinc-200/80">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="text-xl font-bold tabular-nums text-zinc-950">{value}</div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label}</div>
      </div>
    </div>
  );
}

export default function GitHubIntegration() {
  const qc = useQueryClient();
  const [lastSync, setLastSync] = useState<SyncStats | null>(null);
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const connectedBanner = params.get("connected") === "1";
  const error = params.get("error");

  const provider = useQuery({
    queryKey: ["github-provider"],
    queryFn: () => api<GitHubProvider | null>("/v1/integrations/github"),
  });

  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<{ id: string; status: string }[]>("/v1/accounts"),
  });
  const connectedAccountId = accounts.data?.find((a) => a.status === "connected")?.id;
  const { isSyncing } = useIntegrationSyncState("github");
  const { isRunning: awsScanRunning } = useAccountScanRun(connectedAccountId);

  const sync = useMutation({
    mutationKey: GITHUB_SYNC_KEY,
    mutationFn: async () =>
      api<SyncStats>("/v1/integrations/github/sync", {
        method: "POST",
        body: JSON.stringify({ org_login: null }),
      }),
    onSuccess: (stats) => {
      setLastSync(stats);
      qc.invalidateQueries({ queryKey: ["github-provider"] });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["scan-run-latest"] }), 300);
    },
  });

  const disconnect = useMutation({
    mutationFn: () => api<void>("/v1/integrations/github", { method: "DELETE" }),
    onSuccess: () => {
      setLastSync(null);
      qc.invalidateQueries({ queryKey: ["github-provider"] });
    },
  });

  const connect = useMutation({
    mutationFn: () => api<{ url: string }>("/v1/integrations/github/connect-url"),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });

  const p = provider.data;
  const syncTargets = p?.org_logins?.length ? p.org_logins : p?.org_login ? [p.org_login] : p?.login ? [p.login] : [];
  const selectedRepoCount = p?.selected_repos?.length || 0;
  const scannedRepoCount = p?.repos || 0;
  const currentScopeCount = selectedRepoCount || scannedRepoCount;
  const hasScopeDrift = !!p?.last_synced_at && selectedRepoCount > 0 && scannedRepoCount > 0 && selectedRepoCount !== scannedRepoCount;
  const scopeDriftCount = Math.abs(selectedRepoCount - scannedRepoCount);
  const lastSyncAgeMs = p?.last_synced_at ? Date.now() - new Date(p.last_synced_at).getTime() : null;
  const syncState = !p?.last_synced_at
    ? "Pending"
    : hasScopeDrift
      ? "Needs refresh"
      : lastSyncAgeMs && lastSyncAgeMs > 7 * 24 * 60 * 60 * 1000
        ? "Stale"
        : "Synced";
  const syncTone = syncState === "Synced" ? "ok" : syncState === "Pending" ? "idle" : "warn";
  const lastCollectionLabel = formatSync(p?.last_synced_at);
  const protectedRepos = p?.protected_branches || 0;
  const missingProtections = Math.max((p?.repos || 0) - protectedRepos, 0);
  const protectedCoveragePercent = p?.repos ? Math.round((protectedRepos / p.repos) * 100) : 0;
  const scopeDriftSummary =
    selectedRepoCount < scannedRepoCount
      ? `${scopeDriftCount} ${pluralize(scopeDriftCount, "repository")} excluded after latest collection.`
      : `${scopeDriftCount} ${pluralize(scopeDriftCount, "repository")} added after latest collection.`;
  const protectionAccent: "warn" | "ok" | "none" = !p?.repos ? "none" : missingProtections ? "warn" : "ok";
  const protectionTone: "ok" | "warn" | "neutral" = !p?.repos ? "neutral" : missingProtections ? "warn" : "ok";
  const protectionStatus: "review" | "protected" | "pending" = !p?.repos || !p?.last_synced_at
    ? "pending"
    : missingProtections > 0 || hasScopeDrift
      ? "review"
      : "protected";
  const protectionNote = !p?.repos
    ? "Run a sync to collect branch protection evidence."
    : hasScopeDrift
      ? `Scope drift detected. ${scopeDriftSummary}`
      : missingProtections
        ? "No branch protection evidence was found in the last collection."
        : "All scoped repositories had branch protection evidence in the last collection.";

  const findingsUrl =
    "/findings?checks=github.org.mfa_not_enforced,github.org.dormant_members,github.repo.no_branch_protection,github.repo.self_merge_allowed,github.repo.insufficient_reviews";

  const scopeSummary = currentScopeCount
    ? `${currentScopeCount} ${pluralize(currentScopeCount, "repo")} in scope`
    : "No repositories collected yet";

  return (
    <div className="w-full space-y-5 pb-10">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <Link to="/integrations" className="text-sky-700 hover:underline">
            Integrations
          </Link>
          {" / "}Source control
        </p>
        {!p && (
          <>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-950">GitHub evidence source</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-500">
              Repository controls and pull request activity synced into compliance evidence.
            </p>
          </>
        )}
      </div>

      {connectedBanner && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          GitHub connected. Review scope below or run a sync to collect evidence.
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          GitHub connection failed: {error}
        </div>
      )}
      {lastSync && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Sync complete — {lastSync.identity_users} members, {lastSync.repos} repos, {lastSync.repo_protections}{" "}
          protected branches, {lastSync.pull_requests} merged PRs.
        </div>
      )}

      {(isSyncing || awsScanRunning) && (
        <div className="overflow-hidden rounded-xl border border-indigo-100 bg-indigo-50/80">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 text-sm text-indigo-800">
            <Spinner className="h-4 w-4 shrink-0 text-indigo-500" />
            <span className="font-semibold">
              {isSyncing && awsScanRunning
                ? "Syncing GitHub and running AWS scan"
                : isSyncing
                  ? "Syncing GitHub evidence"
                  : "AWS compliance scan running"}
            </span>
            <span className="text-indigo-600/75">— safe to leave this page</span>
          </div>
        </div>
      )}

      {!p ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm shadow-zinc-950/[0.04]">
          <div className="flex flex-wrap items-start gap-5">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-950 text-white">
              <GitHubMark className="h-8 w-8" />
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-zinc-950">Connect GitHub</h2>
              <p className="mt-1 max-w-xl text-sm text-zinc-500">
                Authorize read-only access to collect identity, branch protection, and pull request evidence for SOC 2
                change-management controls.
              </p>
              <button
                onClick={() => connect.mutate()}
                disabled={connect.isPending}
                className="mt-5 rounded-lg bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {connect.isPending ? "Connecting…" : "Connect GitHub"}
              </button>
              {connect.isError && <p className="mt-3 text-sm text-red-600">{(connect.error as Error).message}</p>}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-950 text-white shadow-sm">
                  <GitHubMark className="h-5 w-5" />
                </span>
                <h1 className="text-2xl font-bold tracking-tight text-zinc-950">GitHub evidence source</h1>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200">
                  Connected
                </span>
              </div>
              <p className="mt-2 text-sm text-zinc-600">
                Repository evidence for <span className="font-semibold text-zinc-900">{p.login || "GitHub user"}</span>
                {" · "}
                {scopeSummary}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Link
                to="/integrations/github/edit"
                className={`${HEADER_ACTION_BTN} border border-slate-200 bg-white text-slate-700 shadow-sm shadow-slate-950/[0.03] hover:-translate-y-px hover:border-zinc-300 hover:bg-zinc-50 hover:shadow-md hover:shadow-zinc-950/[0.07]`}
              >
                Edit scope
              </Link>
              <button
                onClick={() => sync.mutate()}
                disabled={isSyncing || syncTargets.length === 0}
                className={`${HEADER_ACTION_BTN} bg-zinc-950 text-white shadow-sm shadow-zinc-950/10 hover:bg-zinc-800`}
              >
                {isSyncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
          </header>

          <HealthStrip
            items={[
              { label: "Sync health", value: syncState, tone: isSyncing ? "sync" : syncTone },
              { label: "Permissions", value: "OAuth healthy", tone: "ok" },
              { label: "Scope", value: currentScopeCount ? `${currentScopeCount} repos` : "Not collected", tone: currentScopeCount ? "ok" : "idle" },
              { label: "Last collection", value: lastCollectionLabel, tone: p.last_synced_at ? "ok" : "idle" },
            ]}
          />

          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <section className={`flex flex-col rounded-xl border border-zinc-200/90 bg-white p-5 shadow-sm shadow-zinc-950/[0.035] ${panelAccentCls(protectionAccent)}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-zinc-950">Repository protection</h3>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">Branch rules and repository activity from the last collection</p>
                </div>
                <ProtectionStatusPill status={protectionStatus} />
              </div>

              <div className="mt-4">
                <p className="text-base font-semibold tracking-[-0.01em] text-zinc-950">
                  {protectedRepos} of {p.repos || 0} repositories protected
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">{protectionNote}</p>
              </div>

              {hasScopeDrift && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Coverage changed after the latest sync. Run sync to refresh metrics.
                </div>
              )}

              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-500">Coverage</span>
                  <span className="font-semibold tabular-nums text-zinc-800">{protectedCoveragePercent}%</span>
                </div>
                <ProgressBar value={protectedCoveragePercent} tone={protectionTone} />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <ActivityMetric icon={IconUsers} label="Members" value={p.identity_users} />
                <ActivityMetric icon={IconSync} label="Merged PRs" value={p.pull_requests} />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-zinc-100 pt-3">
                {missingProtections > 0 && (
                  <Link to="/findings?checks=github.repo.no_branch_protection" className={CARD_ACTION_LINK}>
                    View missing repositories
                    <ArrowIcon />
                  </Link>
                )}
                <Link to={findingsUrl} className={CARD_ACTION_LINK}>
                  View GitHub findings
                  <ArrowIcon />
                </Link>
              </div>
            </section>

            <PanelCard title="Evidence collected" description="Change-management and identity artifacts in your evidence pack">
              <ul className="space-y-2">
                {EVIDENCE_TYPES.map(({ key, label }) => {
                  const collected = !!p.last_synced_at;
                  const branchGap = key === "branch" && collected && missingProtections > 0;
                  const status: "collected" | "review" | "pending" = !collected ? "pending" : branchGap ? "review" : "collected";

                  return (
                    <li
                      key={key}
                      className="flex items-center justify-between gap-3 rounded-lg border border-zinc-100 bg-zinc-50/60 px-3 py-2.5"
                    >
                      <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-zinc-800">
                        <ChecklistIcon status={status} />
                        {label}
                      </span>
                      <EvidenceStatusPill status={status} />
                    </li>
                  );
                })}
              </ul>
            </PanelCard>
          </div>

          <details className="group overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-sm shadow-zinc-950/[0.02]">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-zinc-700 marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="flex items-center justify-between gap-3">
                Connection settings
                <svg
                  className="h-4 w-4 text-zinc-400 transition group-open:rotate-180"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </span>
            </summary>
            <div className="border-t border-red-100 bg-[#fffafa]">
              <div className="flex flex-wrap items-center justify-between gap-6 border-l-[3px] border-l-red-300 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-red-700">Danger zone</p>
                  <p className="mt-1 max-w-3xl text-xs leading-relaxed text-zinc-500">
                    Disconnecting GitHub stops future evidence collection. Existing findings remain until the next sync clears them.
                  </p>
                </div>
                <button
                  onClick={() => disconnect.mutate()}
                  disabled={disconnect.isPending}
                  className="inline-flex h-[34px] shrink-0 items-center rounded-lg border border-red-200 bg-white px-3.5 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50/50 disabled:opacity-60"
                >
                  {disconnect.isPending ? "Disconnecting…" : "Disconnect GitHub"}
                </button>
              </div>
            </div>
          </details>

          {sync.error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {(sync.error as Error).message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
