import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { formatSync, Spinner, StatusDot } from "../components/IntegrationsUi";
import { useIntegrationSyncState } from "../hooks/useIntegrationSyncState";

type Provider = {
  id: string;
  status: string;
  admin_email: string | null;
  domain: string | null;
  last_synced_at: string | null;
  identity_users: number;
  admin_users: number;
  two_step_verification_enforced: boolean | null;
};

const SYNC_KEY = "google-workspace";

export default function GoogleWorkspaceIntegration() {
  const qc = useQueryClient();
  const { data: provider, isLoading } = useQuery({
    queryKey: ["integration", SYNC_KEY],
    queryFn: () => api<Provider | null>("/v1/integrations/google-workspace"),
  });
  const { isSyncing } = useIntegrationSyncState(SYNC_KEY);

  const connect = useMutation({
    mutationFn: () => api<{ url: string }>("/v1/integrations/google-workspace/connect-url"),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  const sync = useMutation({
    mutationFn: () =>
      api("/v1/integrations/google-workspace/sync", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integration", SYNC_KEY] });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["scan-run-latest"] }), 300);
    },
  });

  const disconnect = useMutation({
    mutationFn: () => api("/v1/integrations/google-workspace", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integration", SYNC_KEY] }),
  });

  const p = provider;
  const needsReconnect = p?.status === "error";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="flex items-center gap-3">
        <Link to="/integrations" className="text-sm text-zinc-500 hover:text-zinc-800">← Integrations</Link>
      </div>
      <header>
        <h1 className="text-2xl font-bold text-zinc-950">Google Workspace</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Read-only Admin Directory sync for identity governance evidence: MFA enforcement, inactive users, and admin roster.
        </p>
      </header>

      {isLoading && <p className="text-sm text-zinc-500">Loading…</p>}

      {!isLoading && !p && (
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-zinc-600">Connect with a Google Workspace super-admin account. Requires a separate OAuth app with Admin SDK read-only scopes.</p>
          <button
            onClick={() => connect.mutate()}
            disabled={connect.isPending}
            className="mt-4 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {connect.isPending ? "Redirecting…" : "Connect Google Workspace"}
          </button>
        </section>
      )}

      {p && (
        <div className="space-y-4">
          {needsReconnect && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Authorization expired. Disconnect and connect again to restore sync.
            </div>
          )}
          <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                  <StatusDot tone={needsReconnect ? "warn" : "ok"} />
                  {p.domain || p.admin_email || "Connected"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">Last sync: {formatSync(p.last_synced_at)}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => sync.mutate()}
                  disabled={isSyncing || needsReconnect}
                  className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
                >
                  {isSyncing ? "Syncing…" : "Sync now"}
                </button>
              </div>
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
              <div><dt className="text-zinc-500">Users</dt><dd className="font-semibold">{p.identity_users}</dd></div>
              <div><dt className="text-zinc-500">Admins</dt><dd className="font-semibold">{p.admin_users}</dd></div>
              <div><dt className="text-zinc-500">2SV enforced</dt><dd className="font-semibold">{p.two_step_verification_enforced == null ? "—" : p.two_step_verification_enforced ? "Yes" : "No"}</dd></div>
            </dl>
          </section>
          <button
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
            className="text-sm font-semibold text-red-700 hover:text-red-800 disabled:opacity-60"
          >
            {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
          </button>
          {(sync.error) && (
            <p className="text-sm text-red-700">{(sync.error as Error).message}</p>
          )}
        </div>
      )}
      {isSyncing && (
        <p className="flex items-center gap-2 text-sm text-sky-700"><Spinner className="h-4 w-4" /> Syncing directory…</p>
      )}
    </div>
  );
}
