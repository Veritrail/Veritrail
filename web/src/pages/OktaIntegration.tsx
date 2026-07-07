import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, formatApiError } from "../api";
import { oktaIntegrationSchema, type OktaIntegration } from "../lib/apiSchemas";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import { invalidateIntegrationComplianceCaches } from "../lib/integrationQueryInvalidation";
import "../styles/integration-setup.css";

export default function OktaIntegration() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["okta-integration"],
    queryFn: () => api<OktaIntegration>("/v1/integrations/okta", { schema: oktaIntegrationSchema }),
  });
  const [orgUrl, setOrgUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!data) return;
    setOrgUrl(data.org_url ?? "");
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api<OktaIntegration>("/v1/integrations/okta", {
        method: "PUT",
        schema: oktaIntegrationSchema,
        body: JSON.stringify({ org_url: orgUrl.trim(), api_token: apiToken.trim() || undefined }),
      }),
    onSuccess: () => {
      invalidateIntegrationComplianceCaches(qc, { integrationStatusKey: ["okta-integration"] });
      setApiToken("");
      setSaveError("");
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const sync = useMutation({
    mutationFn: () => api("/v1/integrations/okta/sync", { method: "POST", body: "{}" }),
    onSuccess: () => {
      invalidateIntegrationComplianceCaches(qc, { integrationStatusKey: ["okta-integration"] });
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const disconnect = useMutation({
    mutationFn: () => api<void>("/v1/integrations/okta", { method: "DELETE" }),
    onSuccess: () =>
      invalidateIntegrationComplianceCaches(qc, { integrationStatusKey: ["okta-integration"] }),
  });

  const connected = !!data?.connected;

  return (
    <div className="integration-setup">
      <p className="integration-setup__breadcrumb">
        <Link to="/integrations">Integrations</Link> / Okta
      </p>
      <header className="integration-setup__header">
        <div className="integration-setup__brand">
          <IntegrationBrandIcon brand="okta" size={48} />
          <div>
            <h1 className="integration-setup__title">Okta</h1>
            <p className="integration-setup__subtitle">Directory sync for MFA posture, inactive users, and privileged admin access-review evidence.</p>
          </div>
        </div>
      </header>
      {isLoading && <p className="integration-setup__loading">Loading…</p>}
      {!isLoading && (
        <div className="integration-setup__card">
          <div className="integration-setup__grid integration-setup__grid--2">
            <div className="integration-setup__field--wide">
              <label className="integration-setup__field-label">Org URL</label>
              <input className="integration-setup__input" value={orgUrl} onChange={(e) => setOrgUrl(e.target.value)} placeholder="https://your-org.okta.com" />
            </div>
            <div>
              <label className="integration-setup__field-label">API token</label>
              <input type="password" className="integration-setup__input" value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder={data?.has_api_token ? "••••••••" : ""} />
            </div>
          </div>
          {connected && (
            <p className="integration-setup__callout">
              Users: {data?.identity_users ?? 0} · Admins: {data?.admin_users ?? 0} · MFA policy enforced: {data?.mfa_policy_enforced ? "yes" : "no"}
            </p>
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
