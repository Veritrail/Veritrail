import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, formatApiError } from "../api";
import { z } from "zod";
import "../styles/integration-setup.css";

const intuneSchema = z.object({
  connected: z.boolean(),
  status: z.string(),
  tenant_id: z.string().nullable().optional(),
  last_synced_at: z.string().nullable().optional(),
  device_count: z.number().optional(),
  has_access_token: z.boolean().optional(),
});

export default function IntuneIntegration() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["intune-integration"],
    queryFn: () => api("/v1/integrations/intune", { schema: intuneSchema }),
  });
  const [tenantId, setTenantId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (data?.tenant_id) setTenantId(data.tenant_id);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api("/v1/integrations/intune", {
        method: "PUT",
        schema: intuneSchema,
        body: JSON.stringify({ tenant_id: tenantId.trim(), access_token: accessToken.trim() || undefined }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["intune-integration"] });
      setAccessToken("");
      setSaveError("");
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const sync = useMutation({
    mutationFn: () => api("/v1/integrations/intune/sync", { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["intune-integration"] }),
  });

  return (
    <div className="integration-setup">
      <p className="integration-setup__breadcrumb">
        <Link to="/integrations">Integrations</Link> / Intune
      </p>
      <header className="integration-setup__header">
        <div>
          <h1 className="integration-setup__title">Microsoft Intune</h1>
          <p className="integration-setup__subtitle">Live MDM device inventory for encryption and compliance checks.</p>
        </div>
      </header>
      {!isLoading && (
        <div className="integration-setup__card">
          <label className="integration-setup__field-label">Tenant ID</label>
          <input className="integration-setup__input" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
          <label className="integration-setup__field-label mt-3">Graph API access token</label>
          <input type="password" className="integration-setup__input" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
          {data?.connected && (
            <p className="integration-setup__callout mt-3">Devices synced: {data.device_count ?? 0}</p>
          )}
          {saveError && <p className="integration-setup__error">{saveError}</p>}
          <div className="integration-setup__actions">
            <button type="button" className="integration-setup__btn integration-setup__btn--primary" onClick={() => save.mutate()} disabled={save.isPending}>
              Save
            </button>
            {data?.connected && (
              <button type="button" className="integration-setup__btn" onClick={() => sync.mutate()} disabled={sync.isPending}>
                Sync now
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
