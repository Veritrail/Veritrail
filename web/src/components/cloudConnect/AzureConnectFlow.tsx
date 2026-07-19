import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, formatApiError } from "../../api";
import { useRecheckNotifications } from "../../context/RecheckNotificationsContext";
import { scanFailureAccountLabel } from "../../lib/scanFailureMessages";
import { CloudConnectShell } from "./CloudConnectShell";
import {
  CloudConnectField,
  CloudConnectPermissionRows,
  CloudConnectPermissionsReview,
  CloudConnectValidateColumn,
  type ConnectValidateItem,
} from "./CloudConnectUi";

const AZURE_CORE_PERMISSIONS = [
  { role: "Reader", scope: "Subscription", purpose: "Resource Graph, storage, Activity Log, RBAC, Policy" },
  { role: "Security Reader", scope: "Subscription", purpose: "Microsoft Defender for Cloud posture" },
] as const;

const AZURE_VALIDATE_ITEMS: readonly ConnectValidateItem[] = [
  {
    title: "Client credentials",
    desc: "Veritrail authenticates with your Entra app registration.",
  },
  {
    title: "Subscription access",
    desc: "Checks Reader and Security Reader on the subscription.",
  },
  {
    title: "Initial scan",
    desc: "Queues a scan after the subscription is saved.",
  },
];

type AzureSubscription = {
  id: string;
  subscription_id: string;
  tenant_id: string;
  client_id: string;
  label: string;
  status: string;
};

export function AzureConnectFlow({
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

  const [subscriptionId, setSubscriptionId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [label, setLabel] = useState("");
  const [saveError, setSaveError] = useState("");
  const [showPermissions, setShowPermissions] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [verifyActiveIndex, setVerifyActiveIndex] = useState(0);
  const [draftSub, setDraftSub] = useState<AzureSubscription | null>(null);

  const formReady = Boolean(subscriptionId.trim() && tenantId.trim() && clientId.trim() && clientSecret.trim());

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
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["azure-subscriptions"] });
      qc.invalidateQueries({ queryKey: ["cloud-accounts"] });
      setDraftSub(row);
      setSaveError("");
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const verify = useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean; degraded_checks?: Array<{ check_id: string }> }>(
        `/v1/integrations/azure/subscriptions/${id}/verify`,
        { method: "POST", body: "{}" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["azure-subscriptions"] });
      qc.invalidateQueries({ queryKey: ["cloud-accounts"] });
      setSaveError("");
      setShowSuccess(true);
      window.setTimeout(() => onComplete?.(), 2800);
    },
    onError: (e) => {
      const message = formatApiError(e);
      setSaveError(message);
      if (draftSub) {
        reportScanFailure({
          accountId: draftSub.id,
          accountLabel: scanFailureAccountLabel({
            label: draftSub.label,
            externalId: draftSub.subscription_id,
          }),
          provider: "azure",
          message,
        });
      }
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
    if (verify.isSuccess) setVerifyActiveIndex(AZURE_VALIDATE_ITEMS.length);
    if (verify.isError) {
      setShowSuccess(false);
      setVerifyActiveIndex(0);
    }
  }, [verify.isSuccess, verify.isError]);

  async function handleVerify() {
    setSaveError("");
    try {
      let sub = draftSub;
      if (!sub) {
        sub = await create.mutateAsync();
        setDraftSub(sub);
      }
      verify.mutate(sub.id);
    } catch (e) {
      setSaveError(formatApiError(e));
    }
  }

  const canVerify = draftSub ? true : formReady;

  return (
    <CloudConnectShell
      embedded={embedded}
      showSuccess={showSuccess}
      title="Connect Microsoft Azure"
      subtitle="Register an Entra app with client credentials, assign Reader and Security Reader on the subscription, then verify access."
      headerActions={
        <CloudConnectPermissionsReview
          open={showPermissions}
          onToggle={() => setShowPermissions((open) => !open)}
          title="Core scan permissions"
        >
          <p className="accounts-connect-permissions__lede">
            Veritrail uses subscription-scoped RBAC only. No Microsoft Graph application permissions are required
            for this integration.
          </p>
          <CloudConnectPermissionRows rows={AZURE_CORE_PERMISSIONS} />
        </CloudConnectPermissionsReview>
      }
      footer={
        <>
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              disabled={verify.isPending || create.isPending}
              className="accounts-connect-shell__cancel"
            >
              Cancel
            </button>
          ) : (
            <span />
          )}
          <div className="accounts-connect-shell__footer-cta">
            <button
              type="button"
              className="accounts-connect-shell__cta"
              disabled={!canVerify || verify.isPending || create.isPending}
              onClick={() => void handleVerify()}
            >
              {verify.isPending || create.isPending
                ? "Testing connection..."
                : canVerify
                  ? "Verify →"
                  : "Verify"}
            </button>
          </div>
        </>
      }
    >
      {showPermissions ? (
        <div className="accounts-connect-permissions__inline">
          <p className="accounts-connect-permissions__lede">
            Core scan only — Defender, storage, Resource Graph, Activity Log, privileged RBAC, and Policy checks.
          </p>
          <CloudConnectPermissionRows rows={AZURE_CORE_PERMISSIONS} />
        </div>
      ) : null}

      <div className="accounts-connect-stage">
        <section className="accounts-connect-col accounts-connect-col--scroll">
          <header className="accounts-connect-col__head">
            <span className="accounts-connect-col__num">1</span>
            <h3 className="accounts-connect-col__title">Register app</h3>
          </header>
          <p className="accounts-connect-col__lede">
            In Entra ID, create an app registration with a client secret, then assign Reader and Security Reader on
            your subscription.
          </p>
          <ol className="accounts-connect-setup-steps">
            <li>Entra ID → App registrations → New registration (single tenant).</li>
            <li>Certificates &amp; secrets → New client secret — copy the value.</li>
            <li>
              Subscriptions → Access control (IAM) → Add role assignment → Reader and Security Reader for the app.
            </li>
          </ol>
          <p className="accounts-connect-col__foot-note">
            See <code>docs/azure-setup.md</code> in the repo for Azure CLI examples.
          </p>
        </section>

        <section
          className={`accounts-connect-col accounts-connect-col--trust${
            formReady ? " accounts-connect-col--trust-ready" : ""
          }`}
        >
          <header className="accounts-connect-col__head">
            <span className="accounts-connect-col__num">2</span>
            <h3 className="accounts-connect-col__title">Enter credentials</h3>
          </header>
          <p className="accounts-connect-col__lede">
            Paste the subscription and app registration details below.
          </p>
          <div className="accounts-output-panel accounts-output-panel--trust">
            <CloudConnectField
              label="Subscription ID"
              value={subscriptionId}
              readOnly={false}
              onChange={setSubscriptionId}
            />
            <CloudConnectField label="Tenant ID" value={tenantId} readOnly={false} onChange={setTenantId} />
            <CloudConnectField label="Client ID" value={clientId} readOnly={false} onChange={setClientId} />
            <CloudConnectField
              label="Client secret"
              value={clientSecret}
              readOnly={false}
              onChange={setClientSecret}
              type="password"
            />
            <CloudConnectField
              label="Label"
              value={label}
              readOnly={false}
              onChange={setLabel}
              placeholder="Production Azure"
              helper="Display name in Veritrail."
            />
          </div>
        </section>

        <CloudConnectValidateColumn
          items={AZURE_VALIDATE_ITEMS}
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
