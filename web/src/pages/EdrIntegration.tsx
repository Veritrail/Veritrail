import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useState } from "react";
import { api, formatApiError } from "../api";
import { scannerIntegrationSchema } from "../lib/apiSchemas";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import type { IntegrationBrandId } from "../lib/integrationBrands";
import "../styles/integration-setup.css";

const VENDOR_META: Record<
  string,
  { name: string; brand: IntegrationBrandId; blurb: string; fields: "crowdstrike" | "sentinelone" }
> = {
  crowdstrike: {
    name: "CrowdStrike",
    brand: "crowdstrike",
    blurb:
      "OAuth API client with Hosts read (and Spotlight when licensed). Veritrail grades managed-device coverage and sensor health for host/workload scanning — not endpoint policy administration.",
    fields: "crowdstrike",
  },
  sentinelone: {
    name: "SentinelOne",
    brand: "sentinelone",
    blurb:
      "Management console URL and API token with Agents read. Veritrail grades agent coverage and health for host/workload scanning — not human endpoint-policy workflows.",
    fields: "sentinelone",
  },
};

export default function EdrIntegration() {
  const { vendor: rawVendor = "" } = useParams();
  const vendor = rawVendor.toLowerCase();
  const meta = VENDOR_META[vendor];
  const qc = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [managementUrl, setManagementUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [saveError, setSaveError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["edr-integration", vendor],
    queryFn: () => api(`/v1/integrations/edr/${vendor}`, { schema: scannerIntegrationSchema }),
    enabled: !!meta,
  });
  const connected = !!data?.connected;

  const save = useMutation({
    mutationFn: () => {
      const body =
        meta?.fields === "crowdstrike"
          ? {
              client_id: clientId.trim() || undefined,
              client_secret: clientSecret.trim() || undefined,
              base_url: baseUrl.trim() || undefined,
            }
          : {
              management_url: managementUrl.trim() || undefined,
              api_token: apiToken.trim() || undefined,
            };
      return api(`/v1/integrations/edr/${vendor}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["edr-integration", vendor] });
      setClientId("");
      setClientSecret("");
      setApiToken("");
      setSaveError("");
    },
    onError: (error) => setSaveError(formatApiError(error)),
  });
  const sync = useMutation({
    mutationFn: () => api(`/v1/integrations/edr/${vendor}/sync`, { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["edr-integration", vendor] }),
    onError: (error) => setSaveError(formatApiError(error)),
  });
  const disconnect = useMutation({
    mutationFn: () => api<void>(`/v1/integrations/edr/${vendor}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["edr-integration", vendor] }),
  });

  if (!meta) {
    return (
      <div className="integration-setup">
        <p className="integration-setup__breadcrumb">
          <Link to="/integrations">Integrations</Link> / EDR
        </p>
        <p className="integration-setup__error">Unknown EDR vendor.</p>
      </div>
    );
  }

  const canConnect =
    meta.fields === "crowdstrike"
      ? connected || (clientId.trim() && clientSecret.trim())
      : connected || (managementUrl.trim() && apiToken.trim());

  return (
    <div className="integration-setup">
      <p className="integration-setup__breadcrumb">
        <Link to="/integrations">Integrations</Link> / {meta.name}
      </p>
      <header className="integration-setup__header">
        <div className="integration-setup__brand">
          <IntegrationBrandIcon brand={meta.brand} size={48} />
          <div>
            <h1 className="integration-setup__title">{meta.name}</h1>
            <p className="integration-setup__subtitle">Endpoint / workload scanning evidence.</p>
          </div>
        </div>
      </header>
      {isLoading && <p className="integration-setup__loading">Loading…</p>}
      {!isLoading && (
        <div className="integration-setup__card">
          <p className="integration-setup__callout">{meta.blurb}</p>
          <div className="integration-setup__grid">
            {meta.fields === "crowdstrike" ? (
              <>
                <div>
                  <label className="integration-setup__field-label">API base URL (optional)</label>
                  <input
                    className="integration-setup__input"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={String(data?.config?.base_url ?? "https://api.crowdstrike.com")}
                  />
                </div>
                <div>
                  <label className="integration-setup__field-label">Client ID</label>
                  <input
                    className="integration-setup__input"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder={connected ? "Enter a new client ID to replace" : "OAuth client ID"}
                  />
                </div>
                <div>
                  <label className="integration-setup__field-label">Client secret</label>
                  <input
                    type="password"
                    className="integration-setup__input"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder={connected ? "Enter a new secret to replace" : "OAuth client secret"}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="integration-setup__field-label">Management URL</label>
                  <input
                    className="integration-setup__input"
                    value={managementUrl}
                    onChange={(e) => setManagementUrl(e.target.value)}
                    placeholder={String(data?.config?.management_url ?? "https://usea1.sentinelone.net")}
                  />
                </div>
                <div>
                  <label className="integration-setup__field-label">API token</label>
                  <input
                    type="password"
                    className="integration-setup__input"
                    value={apiToken}
                    onChange={(e) => setApiToken(e.target.value)}
                    placeholder={connected ? "Enter a new token to replace" : "API token"}
                  />
                </div>
              </>
            )}
          </div>
          {connected && (
            <p className="integration-setup__callout">
              Last sync: {String(data?.config?.last_synced_at ?? "—")} · Devices:{" "}
              {typeof data?.config?.device_count === "number" ? data.config.device_count : "—"} · Healthy:{" "}
              {typeof data?.config?.healthy_device_count === "number" ? data.config.healthy_device_count : "—"} ·
              Open findings:{" "}
              {typeof data?.config?.open_findings_count === "number" ? data.config.open_findings_count : "—"}
            </p>
          )}
          {saveError && <p className="integration-setup__error">{saveError}</p>}
          <div className="integration-setup__actions">
            <button
              type="button"
              className="integration-setup__btn integration-setup__btn--primary"
              disabled={save.isPending || !canConnect}
              onClick={() => save.mutate()}
            >
              {connected ? "Update connection" : `Connect ${meta.name}`}
            </button>
            {connected && (
              <button
                type="button"
                className="integration-setup__btn"
                disabled={sync.isPending}
                onClick={() => sync.mutate()}
              >
                Sync now
              </button>
            )}
            {connected && (
              <button
                type="button"
                className="integration-setup__btn integration-setup__btn--danger"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
