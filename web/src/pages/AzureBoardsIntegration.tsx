import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, formatApiError } from "../api";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import "../styles/integration-setup.css";

type AzureBoardsConfig = {
  connected: boolean;
  status: string;
  org_url?: string | null;
  project?: string | null;
  work_item_type?: string;
  has_pat?: boolean;
};

export default function AzureBoardsIntegration() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["azure-boards-integration"],
    queryFn: () => api<AzureBoardsConfig>("/v1/integrations/azure-boards"),
  });
  const [orgUrl, setOrgUrl] = useState("");
  const [project, setProject] = useState("");
  const [pat, setPat] = useState("");
  const [workItemType, setWorkItemType] = useState("Task");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!data) return;
    setOrgUrl(data.org_url ?? "");
    setProject(data.project ?? "");
    setWorkItemType(data.work_item_type || "Task");
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api<AzureBoardsConfig>("/v1/integrations/azure-boards", {
        method: "PUT",
        body: JSON.stringify({
          org_url: orgUrl.trim(),
          project: project.trim(),
          pat: pat.trim() || undefined,
          work_item_type: workItemType.trim() || "Task",
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["azure-boards-integration"] });
      setPat("");
      setSaveError("");
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const disconnect = useMutation({
    mutationFn: () => api<void>("/v1/integrations/azure-boards", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["azure-boards-integration"] }),
  });

  return (
    <div className="integration-setup">
      <p className="integration-setup__breadcrumb"><Link to="/integrations">Integrations</Link> / Azure Boards</p>
      <header className="integration-setup__header">
        <IntegrationBrandIcon brand="azure-devops" size={48} />
        <div>
          <h1 className="integration-setup__title">Azure Boards</h1>
          <p className="integration-setup__subtitle">Create Azure DevOps work items from findings for remediation tracking.</p>
        </div>
      </header>
      {isLoading && <p className="integration-setup__loading">Loading…</p>}
      {!isLoading && (
        <div className="integration-setup__card">
          <div className="integration-setup__grid integration-setup__grid--2">
            <div className="integration-setup__field--wide"><label className="integration-setup__field-label">Org URL</label><input className="integration-setup__input" value={orgUrl} onChange={(e) => setOrgUrl(e.target.value)} placeholder="https://dev.azure.com/myorg" /></div>
            <div><label className="integration-setup__field-label">Project</label><input className="integration-setup__input" value={project} onChange={(e) => setProject(e.target.value)} /></div>
            <div><label className="integration-setup__field-label">Work item type</label><input className="integration-setup__input" value={workItemType} onChange={(e) => setWorkItemType(e.target.value)} /></div>
            <div><label className="integration-setup__field-label">PAT</label><input type="password" className="integration-setup__input" value={pat} onChange={(e) => setPat(e.target.value)} /></div>
          </div>
          {saveError && <p className="integration-setup__error">{saveError}</p>}
          <div className="integration-setup__actions">
            <button type="button" className="integration-setup__btn integration-setup__btn--primary" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
            {data?.connected && <button type="button" className="integration-setup__btn integration-setup__btn--danger" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect</button>}
          </div>
        </div>
      )}
    </div>
  );
}
