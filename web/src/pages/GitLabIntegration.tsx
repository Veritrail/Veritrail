import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { SourceControlManageConnected, type SourceControlManageConfig } from "../components/SourceControlManageConnected";
import { GitLabMark, Spinner } from "../components/IntegrationsUi";
import { GITLAB_SYNC_KEY, useIntegrationSyncState } from "../hooks/useIntegrationSyncState";
import { useAccountScanRun } from "../hooks/useAccountScanRun";
import "../styles/integration-setup.css";

type GitLabProvider = {
  id: string;
  status: string;
  username: string | null;
  group_id: string | null;
  group_ids: string[];
  base_url: string | null;
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

const GITLAB_CONFIG: SourceControlManageConfig = {
  brand: "gitlab" as const,
  title: "GitLab evidence source",
  scopeReposPath: "/v1/integrations/gitlab/scope-repos",
  editScopeHref: "/integrations/gitlab/edit",
  findingsUrl:
    "/findings?checks=gitlab.org.mfa_not_enforced,gitlab.org.dormant_members,gitlab.repo.no_branch_protection,gitlab.repo.self_merge_allowed,gitlab.repo.insufficient_reviews",
  findingsLinkLabel: "View GitLab findings",
  disconnectLabel: "Disconnect GitLab",
  mergedMetricLabel: "Merged MRs",
  evidenceTypes: [
    { key: "identity", label: "Access reviews" },
    { key: "mr", label: "MR approvals" },
    { key: "merge", label: "Self-merge checks" },
    { key: "branch", label: "Branch protections" },
  ],
  accountLabel: (p) => (p as GitLabProvider).username || "GitLab user",
  subtitleSuffix: (p) => {
    const base = (p as GitLabProvider).base_url;
    return base ? base.replace(/^https?:\/\//, "") : "gitlab.com";
  },
};

export default function GitLabIntegration() {
  const qc = useQueryClient();
  const [lastSync, setLastSync] = useState<SyncStats | null>(null);
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const connected = params.get("connected") === "1";
  const error = params.get("error");

  const provider = useQuery({
    queryKey: ["gitlab-provider"],
    queryFn: () => api<GitLabProvider | null>("/v1/integrations/gitlab"),
  });

  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<{ id: string; status: string }[]>("/v1/accounts"),
  });
  const connectedAccountId = accounts.data?.find((a) => a.status === "connected")?.id;
  const { isSyncing } = useIntegrationSyncState("gitlab");
  const { isRunning: awsScanRunning } = useAccountScanRun(connectedAccountId);

  const sync = useMutation({
    mutationKey: GITLAB_SYNC_KEY,
    mutationFn: async () =>
      api<SyncStats>("/v1/integrations/gitlab/sync", {
        method: "POST",
        body: JSON.stringify({ group_id: null }),
      }),
    onSuccess: (stats) => {
      setLastSync(stats);
      qc.invalidateQueries({ queryKey: ["gitlab-provider"] });
      qc.invalidateQueries({ queryKey: [GITLAB_CONFIG.scopeReposPath] });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["scan-run-latest"] }), 300);
    },
  });

  const disconnect = useMutation({
    mutationFn: () => api<void>("/v1/integrations/gitlab", { method: "DELETE" }),
    onSuccess: () => {
      setLastSync(null);
      qc.invalidateQueries({ queryKey: ["gitlab-provider"] });
    },
  });

  const verify = useMutation({
    mutationFn: () => api<{ status: string; username: string | null }>("/v1/integrations/gitlab/verify", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gitlab-provider"] });
    },
  });

  const connect = useMutation({
    mutationFn: () => {
      const base = baseUrlInput.trim() || undefined;
      const qs = base ? `?base_url=${encodeURIComponent(base)}` : "";
      return api<{ url: string }>(`/v1/integrations/gitlab/connect-url${qs}`);
    },
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });

  const p = provider.data;
  const syncTargets = p?.group_ids?.length ? p.group_ids : p?.group_id ? [p.group_id] : [];

  return (
    <div className="w-full pb-10">
      {connected && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          GitLab connected. Review scope below or run a sync to collect evidence.
        </div>
      )}
      {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">GitLab connection failed: {error}</div>}
      {p?.status === "error" && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">GitLab connection needs attention</p>
          <p className="mt-1 text-amber-900/90">
            OAuth access may have expired. Verify the token or reconnect GitLab to restore evidence collection.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => verify.mutate()}
              disabled={verify.isPending}
              className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-60"
            >
              {verify.isPending ? "Verifying…" : "Verify connection"}
            </button>
            <button
              type="button"
              onClick={() => connect.mutate()}
              disabled={connect.isPending}
              className="rounded-lg bg-[#e24329] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c93a22] disabled:opacity-60"
            >
              {connect.isPending ? "Opening GitLab…" : "Reconnect GitLab"}
            </button>
          </div>
          {verify.isError && <p className="mt-3 text-sm text-red-700">{(verify.error as Error).message}</p>}
        </div>
      )}
      {lastSync && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Sync complete — {lastSync.identity_users} members, {lastSync.repos} repos, {lastSync.repo_protections} protected branches, {lastSync.pull_requests}{" "}
          merged MRs.
        </div>
      )}

      {(isSyncing || awsScanRunning) && (
        <div className="mb-5 overflow-hidden rounded-xl border border-indigo-100 bg-indigo-50/80">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 text-sm text-indigo-800">
            <Spinner className="h-4 w-4 shrink-0 text-indigo-500" />
            <span className="font-semibold">
              {isSyncing && awsScanRunning ? "Syncing GitLab and running AWS scan" : isSyncing ? "Syncing GitLab evidence" : "AWS compliance scan running"}
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
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e24329] text-white">
                <GitLabMark className="h-8 w-8" />
              </span>
              <div className="flex-1">
                <h1 className="integration-setup__title">GitLab evidence source</h1>
                <p className="integration-setup__subtitle">
                  Authorize read-only access to collect identity, branch protection, and merge request evidence for SOC 2 change-management controls.
                </p>
                <div className="mt-5 flex max-w-sm items-center gap-3">
                  <input
                    type="url"
                    value={baseUrlInput}
                    onChange={(event) => setBaseUrlInput(event.target.value)}
                    placeholder="https://gitlab.com  (or self-hosted URL)"
                    className="integration-setup__input flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => connect.mutate()}
                  disabled={connect.isPending}
                  className="integration-setup__btn integration-setup__btn--primary mt-3"
                >
                  {connect.isPending ? "Connecting…" : "Connect GitLab"}
                </button>
                {connect.isError && <p className="mt-3 text-sm text-red-600">{(connect.error as Error).message}</p>}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <SourceControlManageConnected
          config={GITLAB_CONFIG}
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
