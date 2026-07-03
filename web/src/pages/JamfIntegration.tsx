import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, formatApiError } from "../api";
import { z } from "zod";
import "../styles/integration-setup.css";

const jamfSchema = z.object({
  connected: z.boolean(),
  status: z.string(),
  base_url: z.string().nullable().optional(),
  last_synced_at: z.string().nullable().optional(),
  device_count: z.number().optional(),
  has_password: z.boolean().optional(),
});

export default function JamfIntegration() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["jamf-integration"],
    queryFn: () => api("/v1/integrations/jamf", { schema: jamfSchema }),
  });
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (data?.base_url) setBaseUrl(data.base_url);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api("/v1/integrations/jamf", {
        method: "PUT",
        schema: jamfSchema,
        body: JSON.stringify({
          base_url: baseUrl.trim(),
          username: username.trim(),
          password: password.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jamf-integration"] });
      setPassword("");
      setSaveError("");
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const sync = useMutation({
    mutationFn: () => api("/v1/integrations/jamf/sync", { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jamf-integration"] }),
  });

  return (
    <div className="integration-setup">
      <p className="integration-setup__breadcrumb">
        <Link to="/integrations">Integrations</Link> / Jamf Pro
      </p>
      <header className="integration-setup__header">
        <div>
          <h1 className="integration-setup__title">Jamf Pro</h1>
          <p className="integration-setup__subtitle">Live Mac fleet inventory for FileVault and compliance evidence.</p>
        </div>
      </header>
      {!isLoading && (
        <div className="integration-setup__card">
          <label className="integration-setup__field-label">Jamf URL</label>
          <input className="integration-setup__input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="yourorg.jamfcloud.com" />
          <label className="integration-setup__field-label mt-3">API user</label>
          <input className="integration-setup__input" value={username} onChange={(e) => setUsername(e.target.value)} />
          <label className="integration-setup__field-label mt-3">Password</label>
          <input type="password" className="integration-setup__input" value={password} onChange={(e) => setPassword(e.target.value)} />
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
