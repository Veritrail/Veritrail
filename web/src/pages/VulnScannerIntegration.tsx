import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, formatApiError } from "../api";
import { scannerIntegrationSchema } from "../lib/apiSchemas";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import type { IntegrationBrandId } from "../lib/integrationBrands";
import "../styles/integration-setup.css";

type ScannerIntegration = {
  connected: boolean;
  status: string;
  vendor: string;
  config: Record<string, unknown>;
};

const VENDOR_META: Record<string, { brand: IntegrationBrandId; title: string; hint: string }> = {
  wiz: {
    brand: "wiz",
    title: "Wiz",
    hint: "API URL, OAuth client ID, and client secret from your Wiz tenant settings.",
  },
  tenable: {
    brand: "tenable",
    title: "Tenable",
    hint: "Tenable.io API keys from Settings → My Account → API Keys.",
  },
  qualys: {
    brand: "qualys",
    title: "Qualys",
    hint: "Qualys platform URL (e.g. https://qualysapi.qg2.apps.qualys.com) and API user credentials.",
  },
  snyk: {
    brand: "snyk",
    title: "Snyk",
    hint: "Snyk org ID and API token from Organization settings → General.",
  },
  orca: {
    brand: "orca",
    title: "Orca Security",
    hint: "Orca API token from Settings → API tokens.",
  },
  aikido: {
    brand: "aikido",
    title: "Aikido",
    hint: "Aikido API token from Integrations → API.",
  },
};

export default function VulnScannerIntegration() {
  const { vendor = "wiz" } = useParams<{ vendor: string }>();
  const key = (vendor || "wiz").toLowerCase();
  const meta = VENDOR_META[key] ?? VENDOR_META.wiz;
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["scanner-integration", key],
    queryFn: () => api(`/v1/integrations/scanners/${key}`, { schema: scannerIntegrationSchema }),
  });

  const [apiUrl, setApiUrl] = useState("");
  const [platformUrl, setPlatformUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [orgId, setOrgId] = useState("");
  const [saveError, setSaveError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");

  useEffect(() => {
    if (!data?.config) return;
    const c = data.config;
    setApiUrl(String(c.api_url ?? ""));
    setPlatformUrl(String(c.platform_url ?? ""));
    setUsername(String(c.username ?? ""));
    setOrgId(String(c.org_id ?? ""));
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api<ScannerIntegration>(`/v1/integrations/scanners/${key}`, {
        method: "PUT",
        body: JSON.stringify({
          api_url: apiUrl.trim() || undefined,
          platform_url: platformUrl.trim() || undefined,
          client_id: clientId.trim() || undefined,
          client_secret: clientSecret.trim() || undefined,
          access_key: accessKey.trim() || undefined,
          secret_key: secretKey.trim() || undefined,
          username: username.trim() || undefined,
          password: password.trim() || undefined,
          api_token: apiToken.trim() || undefined,
          org_id: orgId.trim() || undefined,
        }),
      }),
    onSuccess: (saved) => {
      qc.setQueryData(["scanner-integration", key], saved);
      setSaveError("");
      setClientSecret("");
      setSecretKey("");
      setPassword("");
      setApiToken("");
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const sync = useMutation({
    mutationFn: () => api<{ open_findings_count?: number; last_synced_at?: string }>(`/v1/integrations/scanners/${key}/sync`, { method: "POST", body: "{}" }),
    onSuccess: (res) => {
      setSyncMessage(`Synced ${res.open_findings_count ?? 0} open findings`);
      qc.invalidateQueries({ queryKey: ["scanner-integration", key] });
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const disconnect = useMutation({
    mutationFn: () => api<void>(`/v1/integrations/scanners/${key}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scanner-integration", key] }),
  });

  const connected = !!data?.connected;
  const openCount = data?.config?.open_findings_count;

  return (
    <div className="integration-setup">
      <p className="integration-setup__breadcrumb">
        <Link to="/integrations">Integrations</Link>
        {" / "}{meta.title}
      </p>

      <header className="integration-setup__header">
        <div className="integration-setup__brand">
          <IntegrationBrandIcon brand={meta.brand} size={48} />
          <div>
            <div className="integration-setup__title-row">
              <h1 className="integration-setup__title">{meta.title}</h1>
              {connected && <span className="integration-setup__badge">Connected</span>}
            </div>
            <p className="integration-setup__subtitle">
              Pull open vulnerability findings into Veritrail for the Vulnerability Management composite.
            </p>
          </div>
        </div>
      </header>

      {isLoading && <p className="integration-setup__loading">Loading…</p>}

      {!isLoading && (
        <div className="integration-setup__card">
          <p className="integration-setup__callout">{meta.hint}</p>
          {key === "wiz" && (
            <div className="integration-setup__grid integration-setup__grid--2">
              <div className="integration-setup__field--wide">
                <label className="integration-setup__field-label">API URL</label>
                <input className="integration-setup__input" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://api.us1.app.wiz.io" />
              </div>
              <div>
                <label className="integration-setup__field-label">Client ID</label>
                <input className="integration-setup__input" value={clientId} onChange={(e) => setClientId(e.target.value)} />
              </div>
              <div>
                <label className="integration-setup__field-label">Client secret</label>
                <input type="password" className="integration-setup__input" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
              </div>
            </div>
          )}
          {key === "tenable" && (
            <div className="integration-setup__grid integration-setup__grid--2">
              <div>
                <label className="integration-setup__field-label">Access key</label>
                <input className="integration-setup__input" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} />
              </div>
              <div>
                <label className="integration-setup__field-label">Secret key</label>
                <input type="password" className="integration-setup__input" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} />
              </div>
            </div>
          )}
          {key === "qualys" && (
            <div className="integration-setup__grid integration-setup__grid--2">
              <div className="integration-setup__field--wide">
                <label className="integration-setup__field-label">Platform URL</label>
                <input className="integration-setup__input" value={platformUrl} onChange={(e) => setPlatformUrl(e.target.value)} />
              </div>
              <div>
                <label className="integration-setup__field-label">Username</label>
                <input className="integration-setup__input" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div>
                <label className="integration-setup__field-label">Password</label>
                <input type="password" className="integration-setup__input" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
          )}
          {["snyk", "orca", "aikido"].includes(key) && (
            <div className="integration-setup__grid integration-setup__grid--2">
              {key === "snyk" && (
                <div>
                  <label className="integration-setup__field-label">Org ID</label>
                  <input className="integration-setup__input" value={orgId} onChange={(e) => setOrgId(e.target.value)} />
                </div>
              )}
              <div className={key === "snyk" ? "" : "integration-setup__field--wide"}>
                <label className="integration-setup__field-label">API token</label>
                <input type="password" className="integration-setup__input" value={apiToken} onChange={(e) => setApiToken(e.target.value)} />
              </div>
            </div>
          )}

          {connected && typeof openCount === "number" && (
            <p className="integration-setup__callout">Last sync: {String(data?.config?.last_synced_at ?? "—")} · Open findings: {openCount}</p>
          )}
          {syncMessage && <p className="integration-setup__success">{syncMessage}</p>}
          {saveError && <p className="integration-setup__error">{saveError}</p>}

          <div className="integration-setup__actions">
            <button type="button" className="integration-setup__btn integration-setup__btn--primary" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
            {connected && (
              <button type="button" className="integration-setup__btn" disabled={sync.isPending} onClick={() => sync.mutate()}>Sync now</button>
            )}
            {connected && (
              <button type="button" className="integration-setup__btn integration-setup__btn--danger" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
