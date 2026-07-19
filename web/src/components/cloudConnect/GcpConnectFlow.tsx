import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "../../api";
import { useRecheckNotifications } from "../../context/RecheckNotificationsContext";
import { scanFailureAccountLabel } from "../../lib/scanFailureMessages";
import {
  GCP_AUTH_OPTIONS,
  GCP_CORE_PERMISSIONS,
  type GcpAuthMethod,
  type GcpImpersonationSetup,
  type GcpProject,
  type GcpSetup,
  authMethodLabel,
  expectedScannerSaEmail,
  gcloudSnippet,
  impersonationPlatformSaEmail,
  saGcloudSnippet,
} from "../../lib/gcpConnectSetup";
import { CloudConnectShell } from "./CloudConnectShell";
import {
  CloudConnectCodeBlock,
  CloudConnectField,
  CloudConnectPermissionRows,
  CloudConnectPermissionsReview,
  CloudConnectValidateColumn,
  type ConnectValidateItem,
} from "./CloudConnectUi";

const GCP_VALIDATE_ITEMS: readonly ConnectValidateItem[] = [
  {
    title: "Scanner service account",
    desc: "Veritrail confirms it can impersonate or federate to your scanner SA.",
  },
  {
    title: "Project access",
    desc: "Checks Cloud Resource Manager and Logging read access.",
  },
  {
    title: "Initial scan",
    desc: "Queues a scan after the project is saved.",
  },
];

export function GcpConnectFlow({
  embedded = false,
  onDismiss,
  onComplete,
}: {
  embedded?: boolean;
  onDismiss?: () => void;
  onComplete?: () => void;
}) {
  const qc = useQueryClient();
  const { reportScanFailure } = useRecheckNotifications();

  const [authMethod, setAuthMethod] = useState<GcpAuthMethod>("service_account_impersonation");
  const [projectId, setProjectId] = useState("");
  const [label, setLabel] = useState("");
  const [draftProject, setDraftProject] = useState<GcpProject | null>(null);
  const [projectNumber, setProjectNumber] = useState("");
  const [poolId, setPoolId] = useState("veritrail");
  const [providerId, setProviderId] = useState("veritrail-oidc");
  const [serviceAccountEmail, setServiceAccountEmail] = useState("");
  const [saveError, setSaveError] = useState("");
  const [showPermissions, setShowPermissions] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [verifyActiveIndex, setVerifyActiveIndex] = useState(0);

  const isWif = authMethod === "workload_identity";

  const setupQuery = useQuery({
    queryKey: ["gcp-wif-setup", draftProject?.project_id, draftProject?.wif_subject],
    queryFn: () => {
      const params = new URLSearchParams({
        project_id: draftProject!.project_id,
        wif_subject: draftProject!.wif_subject!,
      });
      if (projectNumber.trim()) params.set("project_number", projectNumber.trim());
      return api<GcpSetup>(`/v1/integrations/gcp/wif/setup?${params}`);
    },
    enabled: Boolean(isWif && draftProject?.project_id && draftProject?.wif_subject),
  });

  const impersonationSetupQuery = useQuery({
    queryKey: ["gcp-impersonation-setup", draftProject?.project_id],
    queryFn: () => {
      const params = new URLSearchParams({ project_id: draftProject!.project_id });
      return api<GcpImpersonationSetup>(`/v1/integrations/gcp/impersonation/setup?${params}`);
    },
    enabled: Boolean(!isWif && draftProject?.project_id),
  });

  const setup = setupQuery.data;
  const impersonationSetup = impersonationSetupQuery.data;

  useEffect(() => {
    if (!draftProject || isWif) return;
    const expected = expectedScannerSaEmail(impersonationSetup, draftProject.project_id);
    if (!expected) return;
    setServiceAccountEmail((current) => (current.trim() ? current : expected));
  }, [draftProject, isWif, impersonationSetup]);

  const create = useMutation({
    mutationFn: () =>
      api<GcpProject>("/v1/integrations/gcp/projects", {
        method: "POST",
        body: JSON.stringify({
          project_id: projectId.trim(),
          label: label.trim() || projectId.trim(),
          auth_method: authMethod,
        }),
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
      qc.invalidateQueries({ queryKey: ["cloud-accounts"] });
      setSaveError("");
      setDraftProject(row);
      setAuthMethod(row.auth_method === "workload_identity" ? "workload_identity" : "service_account_impersonation");
      setPoolId(row.pool_id ?? "veritrail");
      setProviderId(row.provider_id ?? "veritrail-oidc");
      setServiceAccountEmail(row.service_account_email ?? "");
      setProjectNumber(row.project_number ?? "");
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const patchWif = useMutation({
    mutationFn: () =>
      api<GcpProject>(`/v1/integrations/gcp/projects/${draftProject!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          project_number: projectNumber.trim(),
          pool_id: poolId.trim(),
          provider_id: providerId.trim(),
          service_account_email: serviceAccountEmail.trim(),
        }),
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
      qc.invalidateQueries({ queryKey: ["cloud-accounts"] });
      setDraftProject(row);
      setSaveError("");
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const patchImpersonation = useMutation({
    mutationFn: (emailOverride?: string) =>
      api<GcpProject>(`/v1/integrations/gcp/projects/${draftProject!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          service_account_email: (emailOverride ?? serviceAccountEmail).trim(),
        }),
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
      qc.invalidateQueries({ queryKey: ["cloud-accounts"] });
      setDraftProject(row);
      setSaveError("");
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const verify = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; degraded_checks?: Array<{ check_id: string }> }>(
        `/v1/integrations/gcp/projects/${draftProject!.id}/verify`,
        { method: "POST", body: "{}" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
      qc.invalidateQueries({ queryKey: ["cloud-accounts"] });
      setSaveError("");
      setShowSuccess(true);
      window.setTimeout(() => onComplete?.(), 2800);
    },
    onError: (e) => {
      const message = formatApiError(e);
      setSaveError(message);
      reportScanFailure({
        accountId: draftProject!.id,
        accountLabel: scanFailureAccountLabel({
          label: draftProject!.label,
          externalId: draftProject!.project_id,
        }),
        provider: "gcp",
        message,
      });
    },
  });

  useEffect(() => {
    if (!verify.isPending) return;
    setShowSuccess(false);
    setVerifyActiveIndex(0);
    const timers = [
      window.setTimeout(() => setVerifyActiveIndex(1), 650),
      window.setTimeout(() => setVerifyActiveIndex(2), 1350),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [verify.isPending]);

  useEffect(() => {
    if (verify.isSuccess) setVerifyActiveIndex(GCP_VALIDATE_ITEMS.length);
    if (verify.isError) {
      setShowSuccess(false);
      setVerifyActiveIndex(0);
    }
  }, [verify.isSuccess, verify.isError]);

  const wifReady = useMemo(
    () =>
      Boolean(
        projectNumber.trim() &&
          poolId.trim() &&
          providerId.trim() &&
          serviceAccountEmail.trim(),
      ),
    [projectNumber, poolId, providerId, serviceAccountEmail],
  );

  const impersonationReady = useMemo(() => Boolean(serviceAccountEmail.trim()), [serviceAccountEmail]);
  const detailsReady = isWif ? wifReady : impersonationReady;
  const detailsSaved = Boolean(
    draftProject &&
      (isWif
        ? draftProject.project_number && draftProject.service_account_email
        : draftProject.service_account_email),
  );

  const canVerify = Boolean(draftProject && detailsSaved && detailsReady);

  async function saveDetails() {
    if (!draftProject) return;
    if (isWif) {
      await patchWif.mutateAsync();
      return;
    }
    const email = expectedScannerSaEmail(impersonationSetup, draftProject.project_id);
    await patchImpersonation.mutateAsync(email || serviceAccountEmail);
  }

  async function handleVerify() {
    if (!draftProject) return;
    setSaveError("");
    try {
      if (!detailsSaved) await saveDetails();
      verify.mutate();
    } catch (e) {
      setSaveError(formatApiError(e));
    }
  }

  const savingDetails = patchWif.isPending || patchImpersonation.isPending;
  const deployReady = Boolean(draftProject);

  return (
    <CloudConnectShell
      embedded={embedded}
      showSuccess={showSuccess}
      title="Connect Google Cloud"
      subtitle="Deploy a read-only scanner service account in your project, confirm the connection details, and Veritrail will verify access before saving."
      headerActions={
        <CloudConnectPermissionsReview
          open={showPermissions}
          onToggle={() => setShowPermissions((open) => !open)}
          title="Core scan permissions"
        >
          <p className="accounts-connect-permissions__lede">
            Veritrail requests read-only roles on the scanner service account. Service account access also
            requires <code>roles/iam.serviceAccountTokenCreator</code> for the Veritrail platform account.
          </p>
          <CloudConnectPermissionRows rows={GCP_CORE_PERMISSIONS} />
        </CloudConnectPermissionsReview>
      }
      footer={
        <>
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              disabled={verify.isPending}
              className="accounts-connect-shell__cancel"
            >
              Cancel
            </button>
          ) : (
            <span />
          )}
          <div className="accounts-connect-shell__footer-cta">
            {!draftProject ? (
              <button
                type="button"
                className="accounts-connect-shell__cta"
                disabled={!projectId.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? "Creating…" : "Continue"}
              </button>
            ) : (
              <button
                type="button"
                className="accounts-connect-shell__cta"
                disabled={!canVerify || verify.isPending || savingDetails}
                onClick={() => void handleVerify()}
              >
                {verify.isPending ? "Testing connection..." : canVerify ? "Verify →" : "Verify"}
              </button>
            )}
          </div>
        </>
      }
    >
      {showPermissions ? (
        <div className="accounts-connect-permissions__inline">
          <p className="accounts-connect-permissions__lede">
            Core scan only — continuous read-only posture checks across logging, inventory, and security findings.
          </p>
          <CloudConnectPermissionRows rows={GCP_CORE_PERMISSIONS} />
        </div>
      ) : null}

      <div className="accounts-connect-stage">
        <section className="accounts-connect-col accounts-connect-col--scroll">
          <header className="accounts-connect-col__head">
            <span className="accounts-connect-col__num">1</span>
            <h3 className="accounts-connect-col__title">Deploy connector</h3>
          </header>
          <p className="accounts-connect-col__lede">
            {deployReady
              ? `Run the gcloud commands below in ${draftProject!.project_id} (${authMethodLabel(draftProject!.auth_method)}).`
              : "Enter the GCP project ID to scan and choose a connection method."}
          </p>

          {!deployReady ? (
            <div className="accounts-connect-project-form">
              <div className="accounts-connect-auth-choices">
                {GCP_AUTH_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`accounts-connect-auth-choice${authMethod === opt.id ? " is-selected" : ""}`}
                    onClick={() => setAuthMethod(opt.id)}
                  >
                    {opt.recommended ? <span className="accounts-connect-auth-choice__badge">Recommended</span> : null}
                    <span className="accounts-connect-auth-choice__title">{opt.title}</span>
                    <span className="accounts-connect-auth-choice__desc">{opt.description}</span>
                  </button>
                ))}
              </div>
              <CloudConnectField
                label="Project ID"
                value={projectId}
                readOnly={false}
                onChange={setProjectId}
                helper="The GCP project Veritrail will scan."
              />
              <CloudConnectField
                label="Label"
                value={label}
                readOnly={false}
                onChange={setLabel}
                placeholder="Production GCP"
                helper="Display name in Veritrail."
              />
            </div>
          ) : isWif ? (
            <>
              {setupQuery.isLoading ? <p className="accounts-connect-col__lede">Loading setup parameters…</p> : null}
              {setupQuery.isError ? (
                <p className="accounts-output-panel__error">{formatApiError(setupQuery.error)}</p>
              ) : null}
              {setup ? (
                <>
                  <CloudConnectField label="WIF subject (bind in IAM)" value={setup.wif_subject} />
                  <CloudConnectField label="Veritrail issuer URI" value={setup.issuer_uri} />
                  <CloudConnectField label="Token audience" value={setup.token_audience} />
                  <CloudConnectCodeBlock label="gcloud commands (Cloud Shell)" value={gcloudSnippet(setup)} rows={28} />
                </>
              ) : null}
            </>
          ) : (
            <>
              {impersonationSetupQuery.isLoading ? (
                <p className="accounts-connect-col__lede">Loading setup parameters…</p>
              ) : null}
              {impersonationSetupQuery.isError ? (
                <p className="accounts-output-panel__error">{formatApiError(impersonationSetupQuery.error)}</p>
              ) : null}
              {impersonationSetup ? (
                <>
                  <CloudConnectField
                    label="Veritrail connection account (grant TokenCreator to this)"
                    value={impersonationPlatformSaEmail(impersonationSetup)}
                    helper={
                      impersonationSetup.platform_sa_setup_message ??
                      "Grant roles/iam.serviceAccountTokenCreator on your scanner SA to this account."
                    }
                  />
                  <CloudConnectField
                    label="Expected scanner service account"
                    value={impersonationSetup.scanner_sa_email}
                  />
                  <CloudConnectCodeBlock
                    label="gcloud commands (Cloud Shell)"
                    value={saGcloudSnippet(impersonationSetup)}
                    rows={22}
                  />
                </>
              ) : null}
            </>
          )}
        </section>

        <section
          className={`accounts-connect-col accounts-connect-col--trust${
            detailsReady ? " accounts-connect-col--trust-ready" : ""
          }`}
        >
          <header className="accounts-connect-col__head">
            <span className="accounts-connect-col__num">2</span>
            <h3 className="accounts-connect-col__title">Confirm connection</h3>
          </header>
          <p className="accounts-connect-col__lede">
            {deployReady
              ? isWif
                ? "Paste values from your gcloud output after deploying the workload identity pool."
                : "Confirm the scanner service account email from your gcloud output."
              : "Complete step 1 to unlock connection details."}
          </p>

          {deployReady && isWif ? (
            <div className="accounts-output-panel accounts-output-panel--trust">
              <CloudConnectField
                label="Project number"
                value={projectNumber}
                readOnly={false}
                onChange={setProjectNumber}
              />
              <CloudConnectField label="Pool ID" value={poolId} readOnly={false} onChange={setPoolId} />
              <CloudConnectField
                label="Provider ID"
                value={providerId}
                readOnly={false}
                onChange={setProviderId}
              />
              <CloudConnectField
                label="Scanner service account email"
                value={serviceAccountEmail}
                readOnly={false}
                onChange={setServiceAccountEmail}
              />
            </div>
          ) : null}

          {deployReady && !isWif ? (
            <div className="accounts-output-panel accounts-output-panel--trust">
              <CloudConnectField
                label="Scanner service account email"
                value={serviceAccountEmail}
                readOnly={false}
                onChange={setServiceAccountEmail}
                formatHint="Prefilled from setup — edit if your gcloud output differs."
              />
            </div>
          ) : null}
        </section>

        <CloudConnectValidateColumn
          items={GCP_VALIDATE_ITEMS}
          verify={verify}
          verifyActiveIndex={verifyActiveIndex}
          ready={canVerify}
          idle={!canVerify}
        />
      </div>

      {saveError ? (
        <div className="accounts-output-panel__error accounts-connect-stage__error" role="alert">
          {saveError}
        </div>
      ) : null}
    </CloudConnectShell>
  );
}
