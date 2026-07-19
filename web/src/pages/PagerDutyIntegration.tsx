import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState } from "react";
import { api, formatApiError } from "../api";
import { scannerIntegrationSchema } from "../lib/apiSchemas";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import "../styles/integration-setup.css";

export default function PagerDutyIntegration() {
  const qc = useQueryClient();
  const [apiToken, setApiToken] = useState("");
  const [saveError, setSaveError] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["pagerduty-integration"],
    queryFn: () => api("/v1/integrations/pagerduty", { schema: scannerIntegrationSchema }),
  });
  const connected = !!data?.connected;

  const save = useMutation({
    mutationFn: () => api("/v1/integrations/pagerduty", { method: "PUT", body: JSON.stringify({ api_token: apiToken.trim() || undefined }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pagerduty-integration"] });
      setApiToken("");
      setSaveError("");
    },
    onError: (error) => setSaveError(formatApiError(error)),
  });
  const sync = useMutation({
    mutationFn: () => api("/v1/integrations/pagerduty/sync", { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pagerduty-integration"] }),
    onError: (error) => setSaveError(formatApiError(error)),
  });
  const disconnect = useMutation({
    mutationFn: () => api<void>("/v1/integrations/pagerduty", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pagerduty-integration"] }),
  });

  const serviceCount = data?.config?.service_count;
  const openIncidentCount = data?.config?.open_incident_count;

  return (
    <div className="integration-setup">
      <p className="integration-setup__breadcrumb"><Link to="/integrations">Integrations</Link> / PagerDuty</p>
      <header className="integration-setup__header">
        <div className="integration-setup__brand">
          <IntegrationBrandIcon brand="pagerduty" size={48} />
          <div>
            <h1 className="integration-setup__title">PagerDuty</h1>
            <p className="integration-setup__subtitle">Read-only incident-workflow evidence.</p>
          </div>
        </div>
      </header>
      {isLoading && <p className="integration-setup__loading">Loading…</p>}
      {!isLoading && (
        <div className="integration-setup__card">
          <p className="integration-setup__callout">
            Use a REST API access token with read access to users, services, and incidents. Veritrail syncs configured services and open incidents; it does not assert triage quality, response plans, or exercises.
          </p>
          <div className="integration-setup__grid">
            <div>
              <label className="integration-setup__field-label">REST API access token</label>
              <input type="password" className="integration-setup__input" value={apiToken} onChange={(event) => setApiToken(event.target.value)} placeholder={connected ? "Enter a new token to replace the saved one" : "Paste a read-only token"} />
            </div>
          </div>
          {connected && (
            <p className="integration-setup__callout">
              Last sync: {String(data?.config?.last_synced_at ?? "—")} · Services: {typeof serviceCount === "number" ? serviceCount : "—"} · Open incidents: {typeof openIncidentCount === "number" ? openIncidentCount : "—"}
            </p>
          )}
          {saveError && <p className="integration-setup__error">{saveError}</p>}
          <div className="integration-setup__actions">
            <button type="button" className="integration-setup__btn integration-setup__btn--primary" disabled={save.isPending || (!connected && !apiToken.trim())} onClick={() => save.mutate()}>{connected ? "Update token" : "Connect PagerDuty"}</button>
            {connected && <button type="button" className="integration-setup__btn" disabled={sync.isPending} onClick={() => sync.mutate()}>Sync now</button>}
            {connected && <button type="button" className="integration-setup__btn integration-setup__btn--danger" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect</button>}
          </div>
        </div>
      )}
    </div>
  );
}
