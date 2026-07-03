import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, formatApiError } from "../api";
import { scannerIntegrationSchema } from "../lib/apiSchemas";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import type { IntegrationBrandId } from "../lib/integrationBrands";
import "../styles/integration-setup.css";

const VENDOR_META: Record<string, { brand: IntegrationBrandId; title: string; hint: string }> = {
  splunk: {
    brand: "splunk",
    title: "Splunk",
    hint: "Splunk management URL and API token with search access.",
  },
  datadog: {
    brand: "datadog",
    title: "Datadog",
    hint: "Datadog API and application keys with monitor read access.",
  },
  elastic: {
    brand: "elastic",
    title: "Elastic / Sentinel",
    hint: "Elastic cluster URL and API key with alerts index read access.",
  },
};

export default function SiemIntegration() {
  const { vendor = "splunk" } = useParams<{ vendor: string }>();
  const key = (vendor || "splunk").toLowerCase();
  const meta = VENDOR_META[key] ?? VENDOR_META.splunk;
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["siem-integration", key],
    queryFn: () => api(`/v1/integrations/siem/${key}`, { schema: scannerIntegrationSchema }),
  });

  const [baseUrl, setBaseUrl] = useState("");
  const [clusterUrl, setClusterUrl] = useState("");
  const [site, setSite] = useState("datadoghq.com");
  const [index, setIndex] = useState("main");
  const [apiToken, setApiToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [appKey, setAppKey] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!data?.config) return;
    const c = data.config;
    setBaseUrl(String(c.base_url ?? ""));
    setClusterUrl(String(c.cluster_url ?? ""));
    setSite(String(c.site ?? "datadoghq.com"));
    setIndex(String(c.index ?? "main"));
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api(`/v1/integrations/siem/${key}`, {
        method: "PUT",
        body: JSON.stringify({
          base_url: baseUrl.trim() || undefined,
          cluster_url: clusterUrl.trim() || undefined,
          site: site.trim() || undefined,
          index: index.trim() || undefined,
          api_token: apiToken.trim() || undefined,
          api_key: apiKey.trim() || undefined,
          app_key: appKey.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["siem-integration", key] });
      setApiToken("");
      setApiKey("");
      setAppKey("");
      setSaveError("");
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const sync = useMutation({
    mutationFn: () => api(`/v1/integrations/siem/${key}/sync`, { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["siem-integration", key] }),
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const disconnect = useMutation({
    mutationFn: () => api<void>(`/v1/integrations/siem/${key}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["siem-integration", key] }),
  });

  const connected = !!data?.connected;
  const signalCount = data?.config?.signal_count;

  return (
    <div className="integration-setup">
      <p className="integration-setup__breadcrumb">
        <Link to="/integrations">Integrations</Link> / {meta.title}
      </p>
      <header className="integration-setup__header">
        <div className="integration-setup__brand">
          <IntegrationBrandIcon brand={meta.brand} size={48} />
          <div>
            <h1 className="integration-setup__title">{meta.title}</h1>
            <p className="integration-setup__subtitle">Sync monitoring signal summaries into audit-pack SIEM evidence.</p>
          </div>
        </div>
      </header>
      {isLoading && <p className="integration-setup__loading">Loading…</p>}
      {!isLoading && (
        <div className="integration-setup__card">
          <p className="integration-setup__callout">{meta.hint}</p>
          {key === "splunk" && (
            <div className="integration-setup__grid integration-setup__grid--2">
              <div className="integration-setup__field--wide">
                <label className="integration-setup__field-label">Base URL</label>
                <input className="integration-setup__input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://splunk.example.com:8089" />
              </div>
              <div>
                <label className="integration-setup__field-label">Index</label>
                <input className="integration-setup__input" value={index} onChange={(e) => setIndex(e.target.value)} />
              </div>
              <div>
                <label className="integration-setup__field-label">API token</label>
                <input type="password" className="integration-setup__input" value={apiToken} onChange={(e) => setApiToken(e.target.value)} />
              </div>
            </div>
          )}
          {key === "datadog" && (
            <div className="integration-setup__grid integration-setup__grid--2">
              <div>
                <label className="integration-setup__field-label">Site</label>
                <input className="integration-setup__input" value={site} onChange={(e) => setSite(e.target.value)} />
              </div>
              <div>
                <label className="integration-setup__field-label">API key</label>
                <input type="password" className="integration-setup__input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              </div>
              <div>
                <label className="integration-setup__field-label">Application key</label>
                <input type="password" className="integration-setup__input" value={appKey} onChange={(e) => setAppKey(e.target.value)} />
              </div>
            </div>
          )}
          {key === "elastic" && (
            <div className="integration-setup__grid integration-setup__grid--2">
              <div className="integration-setup__field--wide">
                <label className="integration-setup__field-label">Cluster URL</label>
                <input className="integration-setup__input" value={clusterUrl} onChange={(e) => setClusterUrl(e.target.value)} />
              </div>
              <div>
                <label className="integration-setup__field-label">API key</label>
                <input type="password" className="integration-setup__input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              </div>
            </div>
          )}
          {connected && typeof signalCount === "number" && (
            <p className="integration-setup__callout">Last sync: {String(data?.config?.last_synced_at ?? "—")} · Signals: {signalCount}</p>
          )}
          {saveError && <p className="integration-setup__error">{saveError}</p>}
          <div className="integration-setup__actions">
            <button type="button" className="integration-setup__btn integration-setup__btn--primary" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
            {connected && <button type="button" className="integration-setup__btn" disabled={sync.isPending} onClick={() => sync.mutate()}>Sync now</button>}
            {connected && <button type="button" className="integration-setup__btn integration-setup__btn--danger" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect</button>}
          </div>
        </div>
      )}
    </div>
  );
}
