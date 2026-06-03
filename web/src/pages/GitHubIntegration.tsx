import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import {
  formatSync,
  GitHubMark,
  IconBranch,
  IconClock,
  IconRepo,
  IconShield,
  IconSync,
  IconUsers,
  OpStatusRow,
  ProgressBar,
  Spinner,
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
  { key: "identity", label: "Access reviews", icon: IconUsers },
  { key: "pr", label: "PR approvals", icon: IconSync },
  { key: "merge", label: "Self-merge checks", icon: IconShield },
  { key: "branch", label: "Branch protections", icon: IconBranch },
] as const;

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
  const syncTarget = syncTargets.length > 1 ? `${syncTargets.length} sources` : syncTargets[0] || "No source selected";
  const selectedRepoCount = p?.selected_repos?.length || 0;
  const scannedRepoCount = p?.repos || 0;
  const currentScopeCount = selectedRepoCount || scannedRepoCount;
  const scopeLabel = selectedRepoCount ? `${selectedRepoCount} selected repositories` : "All repositories";
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
  const protectionTone = !p?.repos ? "neutral" : missingProtections ? "warn" : "ok";
  const scopeDriftSummary =
    selectedRepoCount < scannedRepoCount
      ? `${scopeDriftCount} ${pluralize(scopeDriftCount, "repository")} excluded after latest collection.`
      : `${scopeDriftCount} ${pluralize(scopeDriftCount, "repository")} added after latest collection.`;

  const findingsUrl =
    "/findings?checks=github.org.mfa_not_enforced,github.org.dormant_members,github.repo.no_branch_protection,github.repo.self_merge_allowed,github.repo.insufficient_reviews";

  return (
    <div className="w-full space-y-8 pb-10">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <Link to="/integrations" className="text-sky-700 hover:underline">
            Integrations
          </Link>
          {" / "}Source control
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-950">GitHub evidence</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-500">
          Identity, repository controls, and pull request activity synced into compliance evidence.
        </p>
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
              {connect.isError && (
                <p className="mt-3 text-sm text-red-600">{(connect.error as Error).message}</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm shadow-zinc-950/[0.04]">
          {/* Hero header */}
          <div className="border-b border-zinc-100 bg-zinc-50/40 px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-950 text-white shadow-sm">
                  <GitHubMark className="h-7 w-7" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-zinc-950">GitHub</h2>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200">
                      Connected
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">
                    Authenticated as <span className="font-medium text-zinc-800">{p.login || "GitHub user"}</span>
                    {" · "}
                    {syncTarget}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">{scopeLabel}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/integrations/github/edit"
                  className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
                >
                  Edit scope
                </Link>
                <button
                  onClick={() => sync.mutate()}
                  disabled={isSyncing || syncTargets.length === 0}
                  className="rounded-lg bg-zinc-950 px-5 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSyncing ? "Syncing…" : "Sync now"}
                </button>
              </div>
            </div>

            <div className="mt-5">
              <OpStatusRow
                items={[
                  {
                    icon: <IconSync className="h-3.5 w-3.5" />,
                    label: "Sync health",
                    value: syncState,
                    tone: isSyncing ? "sync" : syncTone,
                  },
                  {
                    icon: <IconShield className="h-3.5 w-3.5" />,
                    label: "Permissions",
                    value: "OAuth healthy",
                    tone: "ok",
                  },
                  {
                    icon: <IconClock className="h-3.5 w-3.5" />,
                    label: "Last collection",
                    value: lastCollectionLabel,
                    tone: p.last_synced_at ? "ok" : "idle",
                  },
                  {
                    icon: <IconRepo className="h-3.5 w-3.5" />,
                    label: "Scope",
                    value: currentScopeCount ? `${currentScopeCount} repos` : "Not collected",
                    tone: currentScopeCount ? "ok" : "idle",
                  },
                ]}
              />
            </div>
          </div>

          {/* Evidence metrics */}
          <div className="grid gap-px bg-zinc-100 sm:grid-cols-4">
            {[
              { icon: IconUsers, label: "Members", value: p.identity_users },
              { icon: IconRepo, label: "Repositories", value: p.repos },
              { icon: IconBranch, label: "Protected", value: protectedRepos },
              { icon: IconSync, label: "Merged PRs", value: p.pull_requests },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center gap-3 bg-white px-5 py-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-50 text-zinc-500 ring-1 ring-zinc-200/80">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-xl font-bold tabular-nums text-zinc-950">{value}</div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-6 p-6 lg:grid-cols-[1fr_1fr]">
            {/* Branch protection visual */}
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-zinc-900">Branch protection coverage</h3>
                  <p className="mt-0.5 text-xs text-zinc-500">Repositories with protection rules during last collection</p>
                </div>
                <span className="text-2xl font-bold tabular-nums text-zinc-950">
                  {protectedRepos}
                  <span className="text-base font-medium text-zinc-400">/{p.repos || 0}</span>
                </span>
              </div>
              <ProgressBar
                value={protectedCoveragePercent}
                tone={protectionTone}
                label={`${protectedCoveragePercent}% of scoped repositories protected`}
              />
              <p className="mt-3 text-xs leading-relaxed text-zinc-500">
                {!p.repos
                  ? "Run a sync to collect branch protection evidence."
                  : hasScopeDrift
                    ? `Scope drift detected. ${scopeDriftSummary}`
                    : missingProtections
                      ? `${missingProtections} ${pluralize(missingProtections, "repository")} missing branch protection evidence.`
                      : "All analyzed repositories have branch protection evidence."}
              </p>
              {hasScopeDrift && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Coverage changed after the latest sync. Run sync to refresh metrics.
                </div>
              )}
            </div>

            {/* Evidence types collected */}
            <div>
              <h3 className="text-sm font-bold text-zinc-900">Evidence types</h3>
              <p className="mt-0.5 text-xs text-zinc-500">Change-management and identity artifacts in your evidence pack</p>
              <div className="mt-3 space-y-2">
                {EVIDENCE_TYPES.map(({ key, label, icon: Icon }) => {
                  const collected = !!p.last_synced_at;
                  const branchGap = key === "branch" && collected && missingProtections > 0;
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-3 rounded-lg border border-zinc-100 bg-zinc-50/60 px-3 py-2.5"
                    >
                      <span className="flex items-center gap-2.5 text-sm text-zinc-700">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-zinc-500 ring-1 ring-zinc-200/80">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        {label}
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          !collected ? "text-zinc-400" : branchGap ? "text-amber-700" : "text-emerald-700"
                        }`}
                      >
                        {!collected ? "Pending" : branchGap ? "Needs review" : "Collected"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Actions footer */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-zinc-100 bg-zinc-50/30 px-6 py-4">
            <Link
              to={findingsUrl}
              className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-50"
            >
              View GitHub findings
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Link>
            <button
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
              className="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-60"
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect GitHub"}
            </button>
          </div>

          {sync.error && (
            <div className="border-t border-red-100 bg-red-50 px-6 py-3 text-sm text-red-800">
              {(sync.error as Error).message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
