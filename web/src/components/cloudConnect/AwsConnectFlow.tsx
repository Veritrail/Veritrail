import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, formatApiError } from "../../api";
import { useRecheckNotifications } from "../../context/RecheckNotificationsContext";
import { isValidIamRoleArn, sanitizeIamRoleArnInput } from "../../lib/awsArn";
import {
  AWS_CORE_CONNECTION_OPTIONS,
  AWS_CORE_PERMISSIONS,
  AWS_DEPLOY_METHOD_ICON,
  AWS_VALIDATE_ITEMS,
  downloadTerraformModule,
  resolveCoreDeployArtifacts,
  terraformForCoreConnection,
  type AwsConnectAccount,
  type AwsDeployTab,
} from "../../lib/awsConnectSetup";
import { isAccountConnected } from "../../lib/accountConnection";
import { scannerRoleArnExample } from "../../lib/connectionPosture";
import { scanFailureAccountLabel } from "../../lib/scanFailureMessages";
import { CloudConnectShell } from "./CloudConnectShell";
import {
  CloudConnectCodeBlock,
  CloudConnectField,
  CloudConnectPermissionRows,
  CloudConnectPermissionsReview,
  CloudConnectValidateColumn,
} from "./CloudConnectUi";

function AwsDeployColumn({
  acc,
  tab,
  onTabChange,
}: {
  acc: AwsConnectAccount;
  tab: AwsDeployTab;
  onTabChange: (tab: AwsDeployTab) => void;
}) {
  const { consoleUrl, cliCommand } = resolveCoreDeployArtifacts(acc);
  const terraformCode = terraformForCoreConnection(acc);

  return (
    <>
      <div className="accounts-deploy-rail__method">
        <div className="accounts-deploy-tabs">
          {(["console", "cli", "terraform"] as AwsDeployTab[]).map((t) => (
            <button key={t} type="button" className={tab === t ? "is-active" : ""} onClick={() => onTabChange(t)}>
              <img
                src={AWS_DEPLOY_METHOD_ICON[t]}
                alt=""
                aria-hidden
                decoding="async"
                className={`accounts-deploy-tabs__icon accounts-deploy-tabs__icon--${t}`}
              />
              {t === "console" ? "Console" : t === "cli" ? "CLI" : "Terraform"}
            </button>
          ))}
        </div>
      </div>

      <div className="accounts-deploy-rail__action">
        <div className="accounts-deploy-rail__tab-body">
          {tab === "console" ? (
            <>
              <a
                href={consoleUrl}
                target="_blank"
                rel="noreferrer"
                className="accounts-deploy-rail__primary accounts-deploy-rail__launch"
              >
                Launch CloudFormation
                <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H18m0 0v4.5M18 6l-7.5 7.5M6 18h12" />
                </svg>
              </a>
              <p className="accounts-deploy-rail__lock-note">
                <svg fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 0h10.5a2.25 2.25 0 0 1 2.25 2.25v6.75a2.25 2.25 0 0 1-2.25 2.25H6.75a2.25 2.25 0 0 1-2.25-2.25v-6.75a2.25 2.25 0 0 1 2.25-2.25Z"
                  />
                </svg>
                Opens in a new tab. No credentials are shared with Veritrail.
              </p>
            </>
          ) : tab === "cli" ? (
            <CloudConnectCodeBlock label="AWS CLI command" value={cliCommand} rows={14} />
          ) : (
            <>
              <button
                type="button"
                onClick={() => downloadTerraformModule(terraformCode)}
                className="accounts-deploy-rail__primary accounts-deploy-rail__launch"
              >
                Download Terraform module
              </button>
              <CloudConnectCodeBlock label="Terraform (main.tf)" value={terraformCode} rows={22} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

export function AwsConnectFlow({
  acc,
  embedded = false,
  onDismiss,
  onComplete,
}: {
  acc: AwsConnectAccount;
  embedded?: boolean;
  onDismiss?: () => void;
  onComplete?: () => void;
}) {
  const qc = useQueryClient();
  const { reportScanFailure } = useRecheckNotifications();

  const [deployTab, setDeployTab] = useState<AwsDeployTab>("console");
  const [roleArn, setRoleArn] = useState("");
  const [saveError, setSaveError] = useState("");
  const [showPermissions, setShowPermissions] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [verifyActiveIndex, setVerifyActiveIndex] = useState(0);

  const roleArnValid = isValidIamRoleArn(roleArn);
  const roleArnExample = scannerRoleArnExample(acc.account_id, roleArn);

  const patchConnection = useMutation({
    mutationFn: () =>
      api<AwsConnectAccount>(`/v1/accounts/${acc.id}/connection-options`, {
        method: "PATCH",
        body: JSON.stringify(AWS_CORE_CONNECTION_OPTIONS),
      }),
    onSuccess: (updated) => {
      qc.setQueryData<AwsConnectAccount[]>(["accounts"], (rows) =>
        rows ? rows.map((row) => (row.id === updated.id ? updated : row)) : [updated],
      );
    },
  });

  const verify = useMutation({
    mutationFn: () =>
      api<AwsConnectAccount>(`/v1/accounts/${acc.id}/verify`, {
        method: "POST",
        body: JSON.stringify({ role_arn: sanitizeIamRoleArnInput(roleArn) }),
      }),
    onSuccess: (updated) => {
      qc.setQueryData<AwsConnectAccount[]>(["accounts"], (rows) =>
        rows ? rows.map((row) => (row.id === updated.id ? updated : row)) : [updated],
      );
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["accounts-plan-usage"] });
      setSaveError("");
      setRoleArn("");
      if (isAccountConnected(updated)) {
        setShowSuccess(true);
        window.setTimeout(() => onComplete?.(), 2800);
      }
    },
    onError: (e) => {
      const message = formatApiError(e);
      setSaveError(message);
      reportScanFailure({
        accountId: acc.id,
        accountLabel: scanFailureAccountLabel({ label: acc.label, externalId: acc.account_id }),
        provider: "aws",
        message,
      });
      qc.invalidateQueries({ queryKey: ["accounts"] });
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
    if (verify.isSuccess) setVerifyActiveIndex(AWS_VALIDATE_ITEMS.length);
    if (verify.isError) {
      setShowSuccess(false);
      setVerifyActiveIndex(0);
    }
  }, [verify.isSuccess, verify.isError]);

  const roleFieldStatus = verify.isPending
    ? "pending"
    : verify.isSuccess
      ? "success"
      : verify.isError
        ? "error"
        : "idle";

  async function handleVerify() {
    if (!roleArnValid) return;
    setSaveError("");
    try {
      await patchConnection.mutateAsync();
      verify.mutate();
    } catch (e) {
      setSaveError(formatApiError(e));
    }
  }

  return (
    <CloudConnectShell
      embedded={embedded}
      showSuccess={showSuccess}
      title="Connect AWS"
      subtitle="Deploy the read-only connector role in your AWS account, paste the RoleArn output, and Veritrail will verify access before saving."
      headerActions={
        <CloudConnectPermissionsReview
          open={showPermissions}
          onToggle={() => setShowPermissions((open) => !open)}
          title="Core scan permissions"
        >
          <p className="accounts-connect-permissions__lede">
            Veritrail provisions a single read-only IAM role. It cannot modify your AWS resources.
          </p>
          <CloudConnectPermissionRows rows={AWS_CORE_PERMISSIONS} />
        </CloudConnectPermissionsReview>
      }
      footer={
        <>
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              disabled={verify.isPending || patchConnection.isPending}
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
              disabled={!roleArnValid || verify.isPending || patchConnection.isPending}
              onClick={() => void handleVerify()}
            >
              {verify.isPending || patchConnection.isPending
                ? "Testing connection..."
                : roleArnValid
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
            Core scan only — continuous read-only posture checks across IAM, storage, logging, and security
            services.
          </p>
          <CloudConnectPermissionRows rows={AWS_CORE_PERMISSIONS} />
        </div>
      ) : null}

      <div className="accounts-connect-stage">
        <section className="accounts-connect-col accounts-connect-col--scroll">
          <header className="accounts-connect-col__head">
            <span className="accounts-connect-col__num">1</span>
            <h3 className="accounts-connect-col__title">Deploy connector</h3>
          </header>
          <p className="accounts-connect-col__lede">
            Create the IAM role in your AWS account using one of the methods below.
          </p>
          <AwsDeployColumn acc={acc} tab={deployTab} onTabChange={setDeployTab} />
        </section>

        <section
          className={`accounts-connect-col accounts-connect-col--trust${
            roleArnValid ? " accounts-connect-col--trust-ready" : ""
          }`}
        >
          <header className="accounts-connect-col__head">
            <span className="accounts-connect-col__num">2</span>
            <h3 className="accounts-connect-col__title">Confirm trust role</h3>
          </header>
          <p className="accounts-connect-col__lede">
            Use the External ID in your deployment, then paste the RoleArn from the stack output.
          </p>
          <div className="accounts-output-panel accounts-output-panel--trust">
            <CloudConnectField
              label="External ID"
              value={acc.external_id}
              helper="Use this value in the connector template to protect the trust relationship."
            />
            <CloudConnectField
              label="RoleArn output"
              value={roleArn}
              readOnly={false}
              placeholder={roleArnExample}
              onChange={(v) => setRoleArn(sanitizeIamRoleArnInput(v))}
              helper="Paste the RoleArn generated by your deployment."
              formatHint={
                roleArn.trim() && !roleArnValid
                  ? `Enter a valid IAM role ARN (e.g. ${roleArnExample})`
                  : "Find it in AWS: CloudFormation → Stacks → Veritrail connector → Outputs → RoleArn"
              }
              status={roleFieldStatus}
            />
          </div>
        </section>

        <CloudConnectValidateColumn
          items={AWS_VALIDATE_ITEMS}
          verify={verify}
          verifyActiveIndex={verifyActiveIndex}
          ready={roleArnValid}
          idle={!roleArnValid}
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
