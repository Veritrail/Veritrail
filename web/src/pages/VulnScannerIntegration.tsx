import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
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

type FieldKey =
  | "apiUrl"
  | "platformUrl"
  | "clientId"
  | "clientSecret"
  | "accessKey"
  | "secretKey"
  | "username"
  | "password"
  | "apiToken"
  | "orgId";

type FieldDef = {
  key: FieldKey;
  label: string;
  placeholder?: string;
  type?: "text" | "password";
  wide?: boolean;
  hint?: ReactNode;
};

type VendorMeta = {
  brand: IntegrationBrandId;
  title: string;
  subtitle: string;
  recommended: ReactNode;
  fields: FieldDef[];
};

const VENDOR_META: Record<string, VendorMeta> = {
  wiz: {
    brand: "wiz",
    title: "Wiz",
    subtitle: "Pull open cloud vulnerability findings from Wiz into Veritrail's Vulnerability Management composite.",
    recommended: (
      <>
        <strong>Recommended:</strong> create a dedicated Wiz service account scoped to read-only Security Graph
        access, instead of reusing a personal API client. Service accounts survive staff changes and keep the
        integration auditable.
      </>
    ),
    fields: [
      {
        key: "apiUrl",
        label: "API URL",
        placeholder: "https://api.us1.app.wiz.io",
        wide: true,
        hint: "Your Wiz tenant's API endpoint, from Settings → Service Accounts.",
      },
      { key: "clientId", label: "Client ID", hint: "Service account client ID." },
      { key: "clientSecret", label: "Client secret", type: "password", hint: "Shown once at creation — store it securely." },
    ],
  },
  tenable: {
    brand: "tenable",
    title: "Tenable",
    subtitle: "Pull open vulnerability findings from Tenable.io into Veritrail's Vulnerability Management composite.",
    recommended: (
      <>
        <strong>Recommended:</strong> Tenable API keys inherit the permissions of the user who created them — use a
        dedicated service account with read-only access rather than a personal login.
      </>
    ),
    fields: [
      { key: "accessKey", label: "Access key", hint: "From Settings → My Account → API Keys." },
      { key: "secretKey", label: "Secret key", type: "password", hint: "Generated alongside the access key." },
    ],
  },
  qualys: {
    brand: "qualys",
    title: "Qualys",
    subtitle: "Pull open vulnerability findings from Qualys into Veritrail's Vulnerability Management composite.",
    recommended: (
      <>
        <strong>Recommended:</strong> create a dedicated Qualys sub-account with the Reader role instead of using a
        personal login, so the integration keeps working when staff change.
      </>
    ),
    fields: [
      {
        key: "platformUrl",
        label: "Platform URL",
        placeholder: "https://qualysapi.qg2.apps.qualys.com",
        wide: true,
        hint: "Your Qualys API platform URL — varies by shard/region.",
      },
      { key: "username", label: "Username", hint: "Qualys API user." },
      { key: "password", label: "Password", type: "password", hint: "Qualys API user password." },
    ],
  },
  snyk: {
    brand: "snyk",
    title: "Snyk",
    subtitle: "Pull open vulnerability findings from Snyk into Veritrail's Vulnerability Management composite.",
    recommended: (
      <>
        <strong>Requires a paid Snyk plan</strong> — the REST API this integration uses is gated on Free and Team;
        only Enterprise has access, regardless of token type. See{" "}
        <a href="https://snyk.io/plans" target="_blank" rel="noreferrer">
          snyk.io/plans
        </a>
        . On Enterprise: use a service account token where available, or a shared{" "}
        <code>veritrail@yourcompany.com</code> seat, instead of a personal token — so findings aren't tied to one
        engineer's account.
      </>
    ),
    fields: [
      { key: "orgId", label: "Org ID", hint: "From Organization settings → General." },
      {
        key: "apiToken",
        label: "API token",
        type: "password",
        hint: (
          <>
            Create at{" "}
            <a href="https://app.snyk.io/account" target="_blank" rel="noreferrer">
              app.snyk.io → Account settings → API token
            </a>
            .
          </>
        ),
      },
    ],
  },
  orca: {
    brand: "orca",
    title: "Orca Security",
    subtitle: "Pull open vulnerability findings from Orca into Veritrail's Vulnerability Management composite.",
    recommended: (
      <>
        <strong>Recommended:</strong> create a dedicated Orca API user scoped to read-only access instead of reusing
        a personal token.
      </>
    ),
    fields: [
      {
        key: "apiToken",
        label: "API token",
        type: "password",
        wide: true,
        hint: "Create at Settings → API tokens.",
      },
    ],
  },
  aikido: {
    brand: "aikido",
    title: "Aikido",
    subtitle: "Pull open vulnerability findings from Aikido into Veritrail's Vulnerability Management composite.",
    recommended: (
      <>
        <strong>Requires a paid Aikido plan</strong> — the Public REST API is gated on Free. A workspace admin
        creates OAuth client credentials scoped to this integration (Aikido calls the pair an "API key," but it's
        OAuth 2.0 client credentials under the hood).
      </>
    ),
    fields: [
      {
        key: "clientId",
        label: "Client ID",
        hint: (
          <>
            Create at{" "}
            <a href="https://app.aikido.dev/settings/integrations" target="_blank" rel="noreferrer">
              app.aikido.dev → Settings → Integrations
            </a>
            .
          </>
        ),
      },
      {
        key: "clientSecret",
        label: "Client secret",
        type: "password",
        hint: "Shown once at creation — store it securely.",
      },
    ],
  },
};

function scannerFlow(title: string) {
  return [
    { title: `${title} finding`, detail: "Open vulnerability" },
    { title: "Synced", detail: "Imported by Veritrail" },
    { title: "Evidence", detail: "Vulnerability Management" },
  ];
}

export default function VulnScannerIntegration() {
  const { vendor = "wiz" } = useParams<{ vendor: string }>();
  const key = (vendor || "wiz").toLowerCase();
  const meta = VENDOR_META[key] ?? VENDOR_META.wiz;
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["scanner-integration", key],
    queryFn: () => api(`/v1/integrations/scanners/${key}`, { schema: scannerIntegrationSchema }),
  });

  const [form, setForm] = useState<Record<FieldKey, string>>({
    apiUrl: "",
    platformUrl: "",
    clientId: "",
    clientSecret: "",
    accessKey: "",
    secretKey: "",
    username: "",
    password: "",
    apiToken: "",
    orgId: "",
  });
  const [saveError, setSaveError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [testError, setTestError] = useState("");

  useEffect(() => {
    if (!data?.config) return;
    const c = data.config;
    setForm((f) => ({
      ...f,
      apiUrl: String(c.api_url ?? ""),
      platformUrl: String(c.platform_url ?? ""),
      username: String(c.username ?? ""),
      orgId: String(c.org_id ?? ""),
      clientId: String(c.client_id ?? ""),
      accessKey: String(c.access_key ?? ""),
      clientSecret: "",
      secretKey: "",
      password: "",
      apiToken: "",
    }));
  }, [data]);

  function setField(k: FieldKey, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function clearTestFeedback() {
    setTestState("idle");
    setTestError("");
  }

  function buildBody() {
    return {
      api_url: form.apiUrl.trim() || undefined,
      platform_url: form.platformUrl.trim() || undefined,
      client_id: form.clientId.trim() || undefined,
      client_secret: form.clientSecret.trim() || undefined,
      access_key: form.accessKey.trim() || undefined,
      secret_key: form.secretKey.trim() || undefined,
      username: form.username.trim() || undefined,
      password: form.password.trim() || undefined,
      api_token: form.apiToken.trim() || undefined,
      org_id: form.orgId.trim() || undefined,
    };
  }

  const save = useMutation({
    mutationFn: () =>
      api<ScannerIntegration>(`/v1/integrations/scanners/${key}`, {
        method: "PUT",
        body: JSON.stringify(buildBody()),
      }),
    onMutate: () => {
      setSaveError("");
      clearTestFeedback();
    },
    onSuccess: (saved) => {
      qc.setQueryData(["scanner-integration", key], saved);
      setSaveError("");
      setForm((f) => ({ ...f, clientSecret: "", secretKey: "", password: "", apiToken: "" }));
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const sync = useMutation({
    mutationFn: () =>
      api<{ open_findings_count?: number; last_synced_at?: string }>(
        `/v1/integrations/scanners/${key}/sync`,
        { method: "POST", body: "{}" },
      ),
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

  async function runTest() {
    setSaveError("");
    setTestState("testing");
    setTestError("");
    try {
      await api(`/v1/integrations/scanners/${key}/test`, {
        method: "POST",
        body: JSON.stringify(buildBody()),
      });
      setTestState("ok");
      setTimeout(() => setTestState("idle"), 3000);
    } catch (e) {
      setTestState("error");
      setTestError(formatApiError(e));
      setTimeout(() => setTestState("idle"), 4000);
    }
  }

  const connected = !!data?.connected;
  const openCount = data?.config?.open_findings_count as number | undefined;
  const canSave = meta.fields.every((f) => {
    const hasExisting = connected && !!data?.config?.[toSnake(f.key)];
    return form[f.key].trim() || (f.type === "password" && hasExisting) || (f.type !== "password" && hasExisting);
  });

  return (
    <div className="integration-setup integration-setup--elevated">
      <header className="integration-setup__header integration-setup__hero">
        <div className="integration-setup__hero-mark">
          <IntegrationBrandIcon brand={meta.brand} size={64} />
        </div>
        <div className="integration-setup__title-row">
          <h1 className="integration-setup__title">Connect {meta.title}</h1>
          {connected && <span className="integration-setup__badge">Connected</span>}
        </div>
        <p className="integration-setup__subtitle">{meta.subtitle}</p>
        <div className="integration-setup__flow" aria-label={`${meta.title} workflow`}>
          {scannerFlow(meta.title).map((node) => (
            <div className="integration-setup__flow-node" key={node.title}>
              <span className="integration-setup__flow-title">{node.title}</span>
              <span className="integration-setup__flow-detail">{node.detail}</span>
            </div>
          ))}
        </div>
      </header>

      {isLoading && <p className="integration-setup__loading">Loading…</p>}

      {!isLoading && (
        <div className="integration-setup__card">
          <div className="integration-setup__section">
            <p className="integration-setup__section-label">Connection details</p>
            <p className="integration-setup__section-desc">
              Veritrail uses these read-only credentials to pull open findings on a schedule and on demand.
            </p>

            <div className="integration-setup__callout integration-setup__callout--neutral">
              {meta.recommended}
            </div>

            <div className="integration-setup__grid integration-setup__grid--2">
              {meta.fields.map((f) => (
                <div key={f.key} className={f.wide ? "integration-setup__field--wide" : undefined}>
                  <label htmlFor={`scanner-${key}-${f.key}`} className="integration-setup__field-label">
                    {f.label}
                  </label>
                  <input
                    id={`scanner-${key}-${f.key}`}
                    type={f.type === "password" ? "password" : "text"}
                    value={form[f.key]}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={
                      f.type === "password" && connected && data?.config?.[toSnake(f.key)]
                        ? "••••••••••••••••"
                        : f.placeholder
                    }
                    className="integration-setup__input"
                  />
                  {f.hint && <p className="integration-setup__field-hint">{f.hint}</p>}
                </div>
              ))}
            </div>

            {connected && typeof openCount === "number" && (
              <p className="integration-setup__section-desc">
                Last sync: {String(data?.config?.last_synced_at ?? "—")} · Open findings: {openCount}
              </p>
            )}
          </div>

          {saveError && <p className="integration-setup__feedback integration-setup__feedback--error">{saveError}</p>}

          <div className="integration-setup__actions">
            <div className="integration-setup__actions-primary">
              <button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending || !canSave}
                className="integration-setup__btn integration-setup__btn--primary"
              >
                {save.isPending ? "Saving…" : connected ? "Save changes" : `Connect ${meta.title}`}
              </button>
              <button
                type="button"
                onClick={() => void runTest()}
                disabled={testState === "testing" || !canSave}
                className="integration-setup__btn integration-setup__btn--secondary"
              >
                {testState === "testing" ? "Testing…" : "Test connection"}
              </button>
              {connected && (
                <button
                  type="button"
                  onClick={() => sync.mutate()}
                  disabled={sync.isPending}
                  className="integration-setup__btn integration-setup__btn--secondary"
                >
                  {sync.isPending ? "Syncing…" : "Sync now"}
                </button>
              )}
              {testState === "ok" && (
                <span className="integration-setup__feedback integration-setup__feedback--ok integration-setup__feedback--inline">
                  Connection verified.
                </span>
              )}
              {testState === "error" && testError && (
                <span className="integration-setup__feedback integration-setup__feedback--error integration-setup__feedback--inline">
                  {testError}
                </span>
              )}
              {syncMessage && (
                <span className="integration-setup__feedback integration-setup__feedback--ok integration-setup__feedback--inline">
                  {syncMessage}
                </span>
              )}
            </div>
            {connected && (
              <button
                type="button"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
                className="integration-setup__btn integration-setup__btn--danger integration-setup__actions-secondary"
              >
                {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function toSnake(k: FieldKey): string {
  return k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}
