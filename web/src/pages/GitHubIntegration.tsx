import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { integrationStatusNullableSchema } from "../lib/apiSchemas";
import { SourceControlManageConnected, type SourceControlManageConfig } from "../components/SourceControlManageConnected";
import { GitHubMark, Spinner } from "../components/IntegrationsUi";
import { GITHUB_SYNC_KEY, useIntegrationSyncState } from "../hooks/useIntegrationSyncState";
import { useAccountScanRun } from "../hooks/useAccountScanRun";
import "../styles/integration-setup.css";

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

const GITHUB_CONFIG: SourceControlManageConfig = {
  brand: "github" as const,
  title: "GitHub evidence source",
  scopeReposPath: "/v1/integrations/github/scope-repos",
  editScopeHref: "/integrations/github/edit",
  findingsUrl:
    "/findings?checks=github.org.mfa_not_enforced,github.org.dormant_members,github.repo.no_branch_protection,github.repo.self_merge_allowed,github.repo.insufficient_reviews",
  findingsLinkLabel: "View GitHub findings",
  disconnectLabel: "Disconnect GitHub",
  mergedMetricLabel: "Merged PRs",
  evidenceTypes: [
    { key: "identity", label: "Access reviews" },
    { key: "pr", label: "PR approvals" },
    { key: "merge", label: "Self-merge checks" },
    { key: "branch", label: "Branch protections" },
  ],
  accountLabel: (p) => (p as GitHubProvider).login || "GitHub user",
};

export default function GitHubIntegration() {
  const qc = useQueryClient();
  const [lastSync, setLastSync] = useState<SyncStats | null>(null);
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const connectedBanner = params.get("connected") === "1";
  const error = params.get("error");

  const provider = useQuery({
    queryKey: ["github-provider"],
    queryFn: () => api("/v1/integrations/github", { schema: integrationStatusNullableSchema }),
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
      qc.invalidateQueries({ queryKey: [GITHUB_CONFIG.scopeReposPath] });
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

  return (
    <div className="w-full pb-10">
      {connectedBanner && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          GitHub connected. Review scope below or run a sync to collect evidence.
        </div>
      )}
      {error && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">GitHub connection failed: {error}</div>
      )}
      {lastSync && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Sync complete — {lastSync.identity_users} members, {lastSync.repos} repos, {lastSync.repo_protections} protected branches,{" "}
          {lastSync.pull_requests} merged PRs.
        </div>
      )}

      {(isSyncing || awsScanRunning) && (
        <div className="mb-5 overflow-hidden rounded-xl border border-indigo-100 bg-indigo-50/80">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 text-sm text-indigo-800">
            <Spinner className="h-4 w-4 shrink-0 text-indigo-500" />
            <span className="font-semibold">
              {isSyncing && awsScanRunning ? "Syncing GitHub and running AWS scan" : isSyncing ? "Syncing GitHub evidence" : "AWS compliance scan running"}
            </span>
            <span className="text-indigo-600/75">— safe to leave this page</span>
          </div>
        </div>
      )}

      {!p ? (
        <div className="space-y-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            <Link to="/integrations" className="text-sky-700 hover:underline">
              Integrations
            </Link>
            {" / "}Source control
          </p>
          <div className="integration-setup__card p-8">
            <div className="flex flex-wrap items-start gap-5">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-950 text-white">
                <GitHubMark className="h-8 w-8" />
              </span>
              <div className="flex-1">
                <h1 className="integration-setup__title">GitHub evidence source</h1>
                <p className="integration-setup__subtitle">
                  Authorize read-only access to collect identity, branch protection, and pull request evidence for SOC 2 change-management controls.
                </p>
                <button
                  type="button"
                  onClick={() => connect.mutate()}
                  disabled={connect.isPending}
                  className="integration-setup__btn integration-setup__btn--primary mt-5"
                >
                  {connect.isPending ? "Connecting…" : "Connect GitHub"}
                </button>
                {connect.isError && <p className="mt-3 text-sm text-red-600">{(connect.error as Error).message}</p>}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <SourceControlManageConnected
          config={GITHUB_CONFIG}
          provider={p}
          isSyncing={isSyncing}
          onSync={() => sync.mutate()}
          syncDisabled={syncTargets.length === 0}
          onDisconnect={() => disconnect.mutate()}
          disconnectPending={disconnect.isPending}
        />
      )}

      {sync.error && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{(sync.error as Error).message}</div>
      )}
    </div>
  );
}
