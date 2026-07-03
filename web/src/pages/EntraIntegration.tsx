import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "../api";
import { integrationConnectUrlSchema, integrationStatusNullableSchema } from "../lib/apiSchemas";
import { formatSync, Spinner, StatusDot } from "../components/IntegrationsUi";
import { useIntegrationSyncState } from "../hooks/useIntegrationSyncState";
import "../styles/integration-setup.css";

type Provider = {
  id: string;
  status: string;
  tenant_id: string | null;
  admin_email: string | null;
  last_synced_at: string | null;
  identity_users: number;
  admin_users: number;
  security_defaults_enabled: boolean | null;
};

const SYNC_KEY = "entra";

function connectErrorMessage(error: unknown): string {
  const msg = formatApiError(error);
  if (msg.toLowerCase().includes("oauth not configured")) {
    return "Microsoft Entra OAuth is not configured on this server. Set ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET in the API environment.";
  }
  return msg;
}

function entraOauthErrorMessage(code: string): string {
  switch (code) {
    case "oauth_denied":
      return "Connection cancelled or denied at Microsoft.";
    case "oauth_failed":
      return "Microsoft did not return a valid authorization code. Try connecting again.";
    case "server_error":
      return "Server error while completing Entra connection. Try again or check API logs.";
    default:
      return code.replace(/_/g, " ");
  }
}

export default function EntraIntegration() {
  const qc = useQueryClient();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const connectedBanner = params.get("connected") === "1";
  const oauthError = params.get("error");

  const { data: provider, isLoading } = useQuery({
    queryKey: ["integration", SYNC_KEY],
    queryFn: () => api("/v1/integrations/entra", { schema: integrationStatusNullableSchema }),
  });
  const { isSyncing } = useIntegrationSyncState(SYNC_KEY);

  const connect = useMutation({
    mutationFn: () =>
      api("/v1/integrations/entra/connect-url", { schema: integrationConnectUrlSchema }),
    retry: false,
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  const sync = useMutation({
    mutationFn: () =>
      api("/v1/integrations/entra/sync", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integration", SYNC_KEY] });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["scan-run-latest"] }), 300);
    },
  });

  const disconnect = useMutation({
    mutationFn: () => api("/v1/integrations/entra", { method: "DELETE" }),
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
        <h1 className="integration-setup__title">Microsoft Entra ID</h1>
        <p className="integration-setup__subtitle">
          Read-only Microsoft Graph directory sync for identity governance: MFA posture, inactive users, and privileged role assignments.
        </p>
      </header>

      {connectedBanner && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Microsoft Entra ID connected. Run a sync to collect directory evidence.
        </div>
      )}
      {oauthError && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Entra connection failed: {entraOauthErrorMessage(oauthError)}
        </div>
      )}

      {isLoading && <p className="integration-setup__loading">Loading…</p>}

      {!isLoading && !p && (
        <section className="integration-setup__card">
          <div className="integration-setup__section">
            <p className="text-sm text-zinc-600">Connect with a Global Reader or equivalent directory read role. Requires Azure app registration with Graph read-only scopes.</p>
            <button
              type="button"
              onClick={() => connect.mutate()}
              disabled={connect.isPending}
              className="integration-setup__btn integration-setup__btn--primary mt-4"
            >
              {connect.isPending ? "Redirecting…" : "Connect Entra ID"}
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
                    {p.tenant_id || p.admin_email || "Connected"}
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
                <div><dt className="text-zinc-500">Security defaults</dt><dd className="font-semibold">{p.security_defaults_enabled == null ? "—" : p.security_defaults_enabled ? "On" : "Off"}</dd></div>
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
          {sync.error && <p className="text-sm text-red-700">{(sync.error as Error).message}</p>}
        </div>
      )}
      {isSyncing && (
        <p className="mt-4 flex items-center gap-2 text-sm text-sky-700"><Spinner className="h-4 w-4" /> Syncing directory…</p>
      )}
    </div>
  );
}
