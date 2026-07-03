import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "../api";
import {
  googleWorkspaceSyncSchema,
  integrationConnectUrlSchema,
  integrationStatusNullableSchema,
} from "../lib/apiSchemas";
import { formatSync, Spinner, StatusDot } from "../components/IntegrationsUi";
import { useIntegrationSyncState } from "../hooks/useIntegrationSyncState";
import "../styles/integration-setup.css";

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

function connectErrorMessage(error: unknown): string {
  const msg = formatApiError(error);
  if (msg.toLowerCase().includes("oauth not configured")) {
    return "Google Workspace OAuth is not configured on this server. Set GOOGLE_WORKSPACE_CLIENT_ID and GOOGLE_WORKSPACE_CLIENT_SECRET in the API environment.";
  }
  return msg;
}

export default function GoogleWorkspaceIntegration() {
  const qc = useQueryClient();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const connectedBanner = params.get("connected") === "1";
  const oauthError = params.get("error");

  const { data: provider, isLoading } = useQuery({
    queryKey: ["integration", SYNC_KEY],
    queryFn: () => api("/v1/integrations/google-workspace", { schema: integrationStatusNullableSchema }),
  });
  const { isSyncing } = useIntegrationSyncState(SYNC_KEY);

  const connect = useMutation({
    mutationFn: () =>
      api("/v1/integrations/google-workspace/connect-url", { schema: integrationConnectUrlSchema }),
    retry: false,
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  const sync = useMutation({
    mutationFn: () =>
      api("/v1/integrations/google-workspace/sync", {
        method: "POST",
        body: JSON.stringify({}),
        schema: googleWorkspaceSyncSchema,
      }),
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
    <div className="integration-setup mx-auto max-w-3xl px-4 py-8">
      <p className="integration-setup__breadcrumb">
        <Link to="/integrations">Integrations</Link>
      </p>
      <header className="integration-setup__header">
        <h1 className="integration-setup__title">Google Workspace</h1>
        <p className="integration-setup__subtitle">
          Read-only Admin Directory sync for identity governance evidence: MFA enforcement, inactive users, and admin roster.
        </p>
      </header>

      {connectedBanner && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Google Workspace connected. Run a sync to collect directory evidence.
        </div>
      )}
      {oauthError && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Google Workspace connection failed: {oauthError.replace(/_/g, " ")}
        </div>
      )}

      {isLoading && <p className="integration-setup__loading">Loading…</p>}

      {!isLoading && !p && (
        <section className="integration-setup__card">
          <div className="integration-setup__section">
            <p className="text-sm text-zinc-600">Connect with a Google Workspace super-admin account. Requires a separate OAuth app with Admin SDK read-only scopes.</p>
            <button
              type="button"
              onClick={() => connect.mutate()}
              disabled={connect.isPending}
              className="integration-setup__btn integration-setup__btn--primary mt-4"
            >
              {connect.isPending ? "Redirecting…" : "Connect Google Workspace"}
            </button>
            {connect.isError && (
              <p className="mt-3 text-sm text-red-700">{connectErrorMessage(connect.error)}</p>
            )}
          </div>
        </section>
      )}

      {p && (
        <div className="space-y-4">
          {needsReconnect && (
            <div className="integration-setup__callout integration-setup__callout--warning">
              Authorization expired. Disconnect and connect again to restore sync.
            </div>
          )}
          <section className="integration-setup__card">
            <div className="integration-setup__section">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                    <StatusDot tone={needsReconnect ? "warn" : "ok"} />
                    {p.domain || p.admin_email || "Connected"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">Last sync: {formatSync(p.last_synced_at)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => sync.mutate()}
                  disabled={isSyncing || needsReconnect}
                  className="integration-setup__btn integration-setup__btn--primary"
                >
                  {isSyncing ? "Syncing…" : "Sync now"}
                </button>
              </div>
              <dl className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
                <div><dt className="text-zinc-500">Users</dt><dd className="font-semibold">{p.identity_users}</dd></div>
                <div><dt className="text-zinc-500">Admins</dt><dd className="font-semibold">{p.admin_users}</dd></div>
                <div><dt className="text-zinc-500">2SV enforced</dt><dd className="font-semibold">{p.two_step_verification_enforced == null ? "—" : p.two_step_verification_enforced ? "Yes" : "No"}</dd></div>
              </dl>
            </div>
          </section>
          <button
            type="button"
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
            className="integration-setup__btn integration-setup__btn--danger"
          >
            {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
          </button>
          {sync.isError && (
            <p className="text-sm text-red-700">{formatApiError(sync.error)}</p>
          )}
        </div>
      )}
      {isSyncing && (
        <p className="mt-4 flex items-center gap-2 text-sm text-sky-700"><Spinner className="h-4 w-4" /> Syncing directory…</p>
      )}
    </div>
  );
}
