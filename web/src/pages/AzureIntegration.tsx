import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState } from "react";
import { api, formatApiError } from "../api";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import "../styles/integration-setup.css";

type AzureSubscription = {
  id: string;
  subscription_id: string;
  tenant_id: string;
  client_id: string;
  label: string;
  status: string;
  last_scan_at: string | null;
  last_error: string | null;
  has_client_secret: boolean;
};

export default function AzureIntegration() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["azure-subscriptions"],
    queryFn: () => api<AzureSubscription[]>("/v1/integrations/azure/subscriptions"),
  });

  const [subscriptionId, setSubscriptionId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [label, setLabel] = useState("");
  const [saveError, setSaveError] = useState("");
  const [actionState, setActionState] = useState<string | null>(null);

  const subs = data ?? [];
  const connected = subs.some((s) => s.status === "connected");

  const create = useMutation({
    mutationFn: () =>
      api<AzureSubscription>("/v1/integrations/azure/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          subscription_id: subscriptionId.trim(),
          tenant_id: tenantId.trim(),
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
          label: label.trim() || subscriptionId.trim(),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["azure-subscriptions"] });
      setSaveError("");
      setSubscriptionId("");
      setTenantId("");
      setClientId("");
      setClientSecret("");
      setLabel("");
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  async function verifySub(id: string) {
    setActionState(id);
    try {
      await api(`/v1/integrations/azure/subscriptions/${id}/verify`, { method: "POST", body: "{}" });
      qc.invalidateQueries({ queryKey: ["azure-subscriptions"] });
    } catch (e) {
      setSaveError(formatApiError(e));
    } finally {
      setActionState(null);
    }
  }

  async function scanSub(id: string) {
    setActionState(`scan-${id}`);
    try {
      await api(`/v1/integrations/azure/subscriptions/${id}/scan`, { method: "POST", body: "{}" });
      qc.invalidateQueries({ queryKey: ["azure-subscriptions"] });
    } catch (e) {
      setSaveError(formatApiError(e));
    } finally {
      setActionState(null);
    }
  }

  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/v1/integrations/azure/subscriptions/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["azure-subscriptions"] }),
  });

  return (
    <div className="integration-setup">
      <p className="integration-setup__breadcrumb">
        <Link to="/integrations">Integrations</Link>
        {" / "}Microsoft Azure
      </p>

      <header className="integration-setup__header">
        <div className="integration-setup__brand">
          <IntegrationBrandIcon brand="azure" size={48} />
          <div>
            <div className="integration-setup__title-row">
              <h1 className="integration-setup__title">Microsoft Azure</h1>
              {connected && <span className="integration-setup__badge">Connected</span>}
            </div>
            <p className="integration-setup__subtitle">
              Defender for Cloud posture and storage account public blob access checks.
            </p>
          </div>
        </div>
      </header>

      {isLoading && <p className="integration-setup__loading">Loading…</p>}

      {!isLoading && (
        <>
          <div className="integration-setup__card">
            <div className="integration-setup__section">
              <p className="integration-setup__callout">
                Register an app in Entra ID with client credentials and Reader + Security Reader on the subscription.
              </p>
              <div className="integration-setup__grid integration-setup__grid--2">
                <div>
                  <label className="integration-setup__field-label">Subscription ID</label>
                  <input className="integration-setup__input" value={subscriptionId} onChange={(e) => setSubscriptionId(e.target.value)} />
                </div>
                <div>
                  <label className="integration-setup__field-label">Tenant ID</label>
                  <input className="integration-setup__input" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
                </div>
                <div>
                  <label className="integration-setup__field-label">Client ID</label>
                  <input className="integration-setup__input" value={clientId} onChange={(e) => setClientId(e.target.value)} />
                </div>
                <div>
                  <label className="integration-setup__field-label">Client secret</label>
                  <input type="password" className="integration-setup__input" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
                </div>
                <div className="integration-setup__field--wide">
                  <label className="integration-setup__field-label">Label</label>
                  <input className="integration-setup__input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Production Azure" />
                </div>
              </div>
              {saveError && <p className="integration-setup__error">{saveError}</p>}
              <div className="integration-setup__actions">
                <button type="button" className="integration-setup__btn integration-setup__btn--primary" disabled={create.isPending || !subscriptionId || !tenantId || !clientId || !clientSecret} onClick={() => create.mutate()}>
                  Add subscription
                </button>
              </div>
            </div>
          </div>

          {subs.length > 0 && (
            <div className="integration-setup__card">
              <h2 className="integration-setup__section-title">Connected subscriptions</h2>
              <ul className="integration-setup__list">
                {subs.map((s) => (
                  <li key={s.id} className="integration-setup__list-item">
                    <div>
                      <strong>{s.label}</strong>
                      <div className="text-sm text-slate-500">{s.subscription_id} · {s.status}</div>
                      {s.last_error && <div className="text-sm text-red-600">{s.last_error}</div>}
                    </div>
                    <div className="integration-setup__actions">
                      <button type="button" className="integration-setup__btn" disabled={actionState === s.id} onClick={() => verifySub(s.id)}>Verify</button>
                      <button type="button" className="integration-setup__btn" disabled={s.status !== "connected" || actionState === `scan-${s.id}`} onClick={() => scanSub(s.id)}>Scan</button>
                      <button type="button" className="integration-setup__btn integration-setup__btn--danger" onClick={() => remove.mutate(s.id)}>Remove</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
