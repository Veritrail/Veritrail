import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "../api";
import { scannerIntegrationSchema } from "../lib/apiSchemas";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import type { IntegrationBrandId } from "../lib/integrationBrands";
import "../styles/integration-setup.css";

const CROWDSTRIKE_REGION_PRESETS = [
  { id: "us-1", label: "US-1 (Commercial)", base_url: "https://api.crowdstrike.com" },
  { id: "us-2", label: "US-2", base_url: "https://api.us-2.crowdstrike.com" },
  { id: "eu-1", label: "EU-1", base_url: "https://api.eu-1.crowdstrike.com" },
  { id: "us-gov-1", label: "US-GOV-1", base_url: "https://api.laggar.gcw.crowdstrike.com" },
] as const;

function regionIdForBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/$/, "").toLowerCase();
  const match = CROWDSTRIKE_REGION_PRESETS.find(
    (p) => p.base_url.replace(/\/$/, "").toLowerCase() === normalized,
  );
  return match?.id ?? "custom";
}

const VENDOR_META: Record<
  string,
  { name: string; brand: IntegrationBrandId; blurb: string; fields: "crowdstrike" | "sentinelone" }
> = {
  crowdstrike: {
    name: "CrowdStrike",
    brand: "crowdstrike",
    blurb:
      "OAuth API client with Hosts read (and Spotlight when licensed). Veritrail grades managed-device coverage and sensor health for host/workload scanning — not endpoint policy administration. Spotlight is optional and assessed separately from host/sensor evidence.",
    fields: "crowdstrike",
  },
  sentinelone: {
    name: "SentinelOne",
    brand: "sentinelone",
    blurb:
      "Management console URL and API token with Agents read. Veritrail grades agent coverage and health for host/workload scanning — not human endpoint-policy workflows. Threats and Vulnerability module access are optional and assessed separately from agent health.",
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
  const [regionId, setRegionId] = useState("us-1");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [managementUrl, setManagementUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [saveError, setSaveError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["edr-integration", vendor],
    queryFn: () => api(`/v1/integrations/edr/${vendor}`, { schema: scannerIntegrationSchema }),
    enabled: !!meta,
  });
  const connected = !!data?.connected;

  useEffect(() => {
    if (!data?.config || meta?.fields !== "crowdstrike") return;
    const saved = String(data.config.base_url ?? "https://api.crowdstrike.com");
    const id = regionIdForBaseUrl(saved);
    setRegionId(id);
    if (id === "custom") setCustomBaseUrl(saved);
  }, [data?.config, meta?.fields]);

  useEffect(() => {
    if (!data?.config || meta?.fields !== "sentinelone") return;
    const saved = String(data.config.management_url ?? "");
    if (saved && !managementUrl) setManagementUrl(saved);
  }, [data?.config, meta?.fields, managementUrl]);

  const resolvedBaseUrl = useMemo(() => {
    if (regionId === "custom") return customBaseUrl.trim();
    return CROWDSTRIKE_REGION_PRESETS.find((p) => p.id === regionId)?.base_url ?? "";
  }, [regionId, customBaseUrl]);

  const save = useMutation({
    mutationFn: () => {
      const body =
        meta?.fields === "crowdstrike"
          ? {
              client_id: clientId.trim() || undefined,
              client_secret: clientSecret.trim() || undefined,
              base_url: resolvedBaseUrl || undefined,
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
      ? connected || (clientId.trim() && clientSecret.trim() && !!resolvedBaseUrl)
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
            <div className="integration-setup__title-row">
              <h1 className="integration-setup__title">{meta.name}</h1>
              <span className="integration-setup__badge integration-setup__badge--beta">Beta</span>
              {connected && <span className="integration-setup__badge">Connected</span>}
            </div>
            <p className="integration-setup__subtitle">
              Endpoint / workload scanning evidence. Remains Beta until a real-tenant validation gate passes.
            </p>
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
                  <label className="integration-setup__field-label" htmlFor="cs-region">
                    Cloud region
                  </label>
                  <select
                    id="cs-region"
                    className="integration-setup__input"
                    value={regionId}
                    onChange={(e) => setRegionId(e.target.value)}
                  >
                    {CROWDSTRIKE_REGION_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                    <option value="custom">Custom base URL</option>
                  </select>
                  <p className="integration-setup__field-hint">
                    OAuth and Hosts must use the Falcon cloud that matches your tenant. Wrong region often looks like
                    a credentials failure.
                  </p>
                </div>
                {regionId === "custom" && (
                  <div>
                    <label className="integration-setup__field-label" htmlFor="cs-base-url">
                      API base URL
                    </label>
                    <input
                      id="cs-base-url"
                      className="integration-setup__input"
                      value={customBaseUrl}
                      onChange={(e) => setCustomBaseUrl(e.target.value)}
                      placeholder="https://api.example.crowdstrike.com"
                    />
                  </div>
                )}
                {regionId !== "custom" && (
                  <div>
                    <label className="integration-setup__field-label">API base URL</label>
                    <input className="integration-setup__input" value={resolvedBaseUrl} readOnly disabled />
                  </div>
                )}
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
                  <p className="integration-setup__field-hint">
                    Requires Hosts read. Spotlight licensing is optional and does not block host/sensor evidence.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="integration-setup__field-label" htmlFor="s1-mgmt">
                    Management URL
                  </label>
                  <input
                    id="s1-mgmt"
                    className="integration-setup__input"
                    value={managementUrl}
                    onChange={(e) => setManagementUrl(e.target.value)}
                    placeholder={String(data?.config?.management_url ?? "https://usea1.sentinelone.net")}
                  />
                  <p className="integration-setup__field-hint">
                    Must be an https management console host (example: <code>https://usea1.sentinelone.net</code>).
                    Validated before save.
                  </p>
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
                  <p className="integration-setup__field-hint">
                    Requires Agents read. Threats and Vulnerability module access are optional and assessed separately.
                  </p>
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
