import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState } from "react";
import { api, formatApiError } from "../api";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import "../styles/integration-setup.css";

type GcpProject = {
  id: string;
  project_id: string;
  label: string;
  status: string;
  last_scan_at: string | null;
  last_error: string | null;
  has_service_account: boolean;
};

export default function GcpIntegration() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["gcp-projects"],
    queryFn: () => api<GcpProject[]>("/v1/integrations/gcp/projects"),
  });

  const [projectId, setProjectId] = useState("");
  const [label, setLabel] = useState("");
  const [serviceAccountJson, setServiceAccountJson] = useState("");
  const [saveError, setSaveError] = useState("");
  const [actionState, setActionState] = useState<string | null>(null);

  const projects = data ?? [];
  const connected = projects.some((p) => p.status === "connected");

  const create = useMutation({
    mutationFn: () =>
      api<GcpProject>("/v1/integrations/gcp/projects", {
        method: "POST",
        body: JSON.stringify({
          project_id: projectId.trim(),
          label: label.trim() || projectId.trim(),
          service_account_json: serviceAccountJson.trim(),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
      setSaveError("");
      setProjectId("");
      setLabel("");
      setServiceAccountJson("");
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  async function verifyProject(id: string) {
    setActionState(id);
    try {
      await api(`/v1/integrations/gcp/projects/${id}/verify`, { method: "POST", body: "{}" });
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
    } catch (e) {
      setSaveError(formatApiError(e));
    } finally {
      setActionState(null);
    }
  }

  async function scanProject(id: string) {
    setActionState(`scan-${id}`);
    try {
      await api(`/v1/integrations/gcp/projects/${id}/scan`, { method: "POST", body: "{}" });
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
    } catch (e) {
      setSaveError(formatApiError(e));
    } finally {
      setActionState(null);
    }
  }

  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/v1/integrations/gcp/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gcp-projects"] }),
  });

  return (
    <div className="integration-setup">
      <p className="integration-setup__breadcrumb">
        <Link to="/integrations">Integrations</Link>
        {" / "}Google Cloud
      </p>

      <header className="integration-setup__header">
        <div className="integration-setup__brand">
          <IntegrationBrandIcon brand="gcp" size={48} />
          <div>
            <div className="integration-setup__title-row">
              <h1 className="integration-setup__title">Google Cloud</h1>
              {connected && <span className="integration-setup__badge">Connected</span>}
            </div>
            <p className="integration-setup__subtitle">
              Phase-one posture checks for audit logging and compute instances with public IPs.
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
                Create a service account with Viewer + Logging Viewer roles. Paste the downloaded JSON key below.
              </p>
              <div className="integration-setup__grid integration-setup__grid--2">
                <div>
                  <label className="integration-setup__field-label" htmlFor="gcp-project-id">Project ID</label>
                  <input id="gcp-project-id" className="integration-setup__input" value={projectId} onChange={(e) => setProjectId(e.target.value)} />
                </div>
                <div>
                  <label className="integration-setup__field-label" htmlFor="gcp-label">Label</label>
                  <input id="gcp-label" className="integration-setup__input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Production GCP" />
                </div>
                <div className="integration-setup__field--wide">
                  <label className="integration-setup__field-label" htmlFor="gcp-sa">Service account JSON</label>
                  <textarea id="gcp-sa" className="integration-setup__textarea" rows={6} value={serviceAccountJson} onChange={(e) => setServiceAccountJson(e.target.value)} />
                </div>
              </div>
              {saveError && <p className="integration-setup__error">{saveError}</p>}
              <div className="integration-setup__actions">
                <button type="button" className="integration-setup__btn integration-setup__btn--primary" disabled={!projectId.trim() || !serviceAccountJson.trim() || create.isPending} onClick={() => create.mutate()}>
                  Add project
                </button>
              </div>
            </div>
          </div>

          {projects.length > 0 && (
            <div className="integration-setup__card">
              <h2 className="integration-setup__section-title">Connected projects</h2>
              <ul className="integration-setup__list">
                {projects.map((p) => (
                  <li key={p.id} className="integration-setup__list-item">
                    <div>
                      <strong>{p.label}</strong>
                      <div className="text-sm text-slate-500">{p.project_id} · {p.status}</div>
                      {p.last_error && <div className="text-sm text-red-600">{p.last_error}</div>}
                    </div>
                    <div className="integration-setup__actions">
                      <button type="button" className="integration-setup__btn" disabled={actionState === p.id} onClick={() => verifyProject(p.id)}>Verify</button>
                      <button type="button" className="integration-setup__btn" disabled={p.status !== "connected" || actionState === `scan-${p.id}`} onClick={() => scanProject(p.id)}>Scan</button>
                      <button type="button" className="integration-setup__btn integration-setup__btn--danger" onClick={() => remove.mutate(p.id)}>Remove</button>
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
