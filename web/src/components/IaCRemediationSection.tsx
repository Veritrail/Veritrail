import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { Link } from "react-router-dom";
import { api } from "../api";
import {
  generatedPolicySchema,
  iacRepositoryIntegrationSchema,
  iacSnippetsSchema,
  remediationRunnerStatusSchema,
} from "../lib/apiSchemas";
import {
  automatedRemediationUnavailableCopy,
  type FindingScopeProvider,
} from "../lib/findingDisplay";
import { refreshRemediationExecution, useRemediationExecution } from "../hooks/useRemediationExecution";
import { ExceptionDocIcon } from "./ExceptionDocIcon";
import {
  drawerBodyText,
  drawerBtnText,
  drawerChip,
  drawerEyebrow,
} from "./drawerStyles";

/** Matches Suggested policy “medium confidence” pill in FindingDrawer. */
const SSM_REVIEW_PILL = `inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 ${drawerChip} text-amber-900`;

type IaCResponse = {
  iac_status: string;
  reason?: string;
  terraform?: string | null;
  cloudformation?: string | null;
  cli?: string[];
  hints?: string[];
  pr_automation?: {
    available: boolean;
    github_connected?: boolean;
    gitlab_connected?: boolean;
    providers?: string[];
    repos: { full_name: string; default_branch: string }[];
    note: string;
  };
  apply_paths?: {
    terraform_pr: boolean;
    terraform_generic: boolean;
    customer_automation: boolean;
  };
  ssm_remediation?: SsmRemediationMeta;
};

type SsmRemediationMeta = {
  module_id: string;
  module_label: string;
  module_enabled: boolean;
  module_deployed: boolean;
  action: string | null;
  action_label: string;
  execution: string;
  automation_role_name: string;
  resource_region: string;
  automation_region: string;
  runbook?: { document_name: string; owner: string; note?: string; source_url?: string } | null;
  requires_veritrail_document: boolean;
  automation_provider?: "aws-owned" | "veritrail";
  aws_document_name?: string | null;
  automation_confidence?: string | null;
  automation_note?: string | null;
  aws_runbook_docs_url?: string | null;
};

type DispatchResponse = {
  plan: Record<string, unknown>;
  plan_id?: string;
  automation_region?: string;
  document_name?: string;
  resource_region?: string;
  iam_inline_policy?: Record<string, unknown>;
  automation_execution_id?: string | null;
  automation_error?: string | null;
  prepared?: boolean;
  executed?: boolean;
  cli: { put_events?: string; start_automation?: string };
  cfn_template_url: string;
  instructions: string[];
};

type RunnerStatus = {
  ready: boolean;
  automation_region: string;
  blockers: string[];
  warnings: string[];
  hints: string[];
  document?: { name: string; exists: boolean; status?: string | null };
};

function formatAutomationStartError(message: string): string {
  if (
    message.includes("AccessDenied") &&
    message.includes("ssm:StartAutomationExecution") &&
    message.includes("VeritrailScannerRole")
  ) {
    if (message.includes(":document/")) {
      return (
        "VeritrailScannerRole has VeritrailSsmRemediationStart but it does not allow StartAutomationExecution on this " +
        "document ARN. Update VeritrailAccountConnector to the latest connector template (document resource in IAM), " +
        "wait for UPDATE_COMPLETE, then Accounts → Verify capabilities and Retry."
      );
    }
    return (
      "VeritrailScannerRole is missing ssm:StartAutomationExecution. " +
      "Update your VeritrailAccountConnector CloudFormation stack with SSM remediation modules enabled " +
      "(EnableIamAccessKeyRemediation=Yes, etc.), then Accounts → Verify capabilities."
    );
  }
  if (message.includes("AutomationAssumeRole") && message.includes("Unknown parameter")) {
    return (
      "The API sent an invalid StartAutomationExecution parameter (AutomationAssumeRole). " +
      "Restart the Veritrail API to pick up the latest build, then Retry."
    );
  }
  if (/cross-account pass role/i.test(message)) {
    return (
      "SSM could not use the remediation role in your AWS account (cross-account PassRole). " +
      "Restart the Veritrail API to pick up the latest fix, then Retry. If it persists, confirm " +
      "VeritrailRemediationAutomationRole exists and the connector stack allows iam:PassRole to it."
    );
  }
  if (/PutPublicAccessBlock/i.test(message) && /VeritrailRemediationAutomationRole/i.test(message)) {
    return (
      "The AWS runbook started, but VeritrailRemediationAutomationRole cannot change bucket public access settings. " +
      "Update your connector with EnableS3Remediation=Yes (this updates the nested veritrail-remediation-ssm stack), " +
      "wait for UPDATE_COMPLETE, then Start again."
    );
  }
  return message;
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-zinc-600">{label}</span>
        <button
          type="button"
          className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
          onClick={() => {
            void navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-64 overflow-auto rounded-lg border border-zinc-200 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100">
        {text}
      </pre>
    </div>
  );
}

function versionControlPrLabel(providers: string[]): string {
  if (providers.length > 1) return "Version control PR";
  if (providers[0] === "gitlab") return "GitLab merge request";
  return "Git PR";
}

function ssmHumanPlanLabels(
  checkId: string,
  provider: "aws-owned" | "veritrail",
): { documentTitle: string; roleTitle: string } {
  if (checkId === "iam.role.least_privilege_policy" || checkId.startsWith("iam.")) {
    return {
      documentTitle: provider === "aws-owned" ? "AWS IAM remediation runbook" : "Least-privilege IAM remediation",
      roleTitle: "Veritrail managed automation role",
    };
  }
  if (checkId.startsWith("ec2.security_group.")) {
    return {
      documentTitle: provider === "aws-owned" ? "AWS security group runbook" : "Revoke public ingress",
      roleTitle: "Veritrail managed automation role",
    };
  }
  return {
    documentTitle: provider === "aws-owned" ? "AWS remediation runbook" : "Veritrail automation document",
    roleTitle: "Veritrail managed automation role",
  };
}

function iamRoleConsoleUrl(roleName: string, region: string): string {
  const reg = encodeURIComponent(region || "us-east-1");
  const role = encodeURIComponent(roleName);
  return `https://${reg}.console.aws.amazon.com/iam/home#/roles/details/${role}`;
}

const IAM_LEAST_PRIVILEGE_CHECK = "iam.role.least_privilege_policy";

function SsmInlineStatusPill({
  tone,
  children,
}: {
  tone: "checking" | "blocked" | "ready" | "not_ready";
  children: React.ReactNode;
}) {
  if (tone === "blocked") {
    return <span className={SSM_REVIEW_PILL}>{children}</span>;
  }

  const toneClass = {
    checking: "bg-zinc-100 text-zinc-600",
    ready: "bg-emerald-50 text-emerald-800",
    not_ready: "bg-zinc-100 text-zinc-600",
  }[tone];

  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${toneClass}`}>
      {children}
    </span>
  );
}

type ChecklistStepStatus = "pending" | "checking" | "complete" | "running" | "failed";

type SsmExecPhase = "idle" | "running" | "success" | "failed";

function SsmChecklistStep({
  step,
  title,
  description,
  status,
  footer,
}: {
  step: number;
  title: string;
  description: string;
  status: ChecklistStepStatus;
  footer?: React.ReactNode;
}) {
  const statusLabel = {
    pending: "Pending",
    checking: "Checking",
    complete: "Complete",
    running: "Running",
    failed: "Failed",
  }[status];
  const statusClass = {
    pending: "bg-zinc-100 text-zinc-600",
    checking: "bg-zinc-100 text-zinc-600",
    complete: "bg-emerald-50 text-emerald-700",
    running: "bg-indigo-50 text-indigo-700",
    failed: "bg-amber-50 text-amber-800",
  }[status];

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[13px] font-semibold text-indigo-600">
            {step}
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-5 text-zinc-900">{title}</p>
            <p className="mt-0.5 text-[12px] leading-[18px] text-zinc-500">{description}</p>
          </div>
        </div>
        <span className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusClass}`}>
          {statusLabel}
        </span>
      </div>
      {footer ? <div className="ml-10 mt-2">{footer}</div> : null}
    </div>
  );
}

function SsmAutomationWorkflowCard({
  isIamLeastPriv,
  policyLoading,
  policyReady,
  inlineStatusTone,
  inlineStatusLabel,
  documentTitle,
  documentUrl,
  documentTechnicalName,
  roleTitle,
  roleTechnicalName,
  automationRegion,
  execPhase,
  runnerReady,
  approvalConfirmed,
  onApprovalChange,
  onShowPolicy,
  policyReviewAcknowledged = false,
  automationExecutionId,
  automationError,
  statusSyncError,
  onRefreshExecution,
  executionFetching,
  runDisabled,
  runRunning,
  onRun,
  connectorFixNeeded,
}: {
  isIamLeastPriv: boolean;
  policyLoading: boolean;
  policyReady: boolean;
  inlineStatusTone: "checking" | "blocked" | "ready" | "not_ready";
  inlineStatusLabel: string;
  documentTitle: string;
  documentUrl?: string | null;
  documentTechnicalName: string;
  roleTitle: string;
  roleTechnicalName: string;
  automationRegion: string;
  execPhase: SsmExecPhase;
  runnerReady: boolean;
  approvalConfirmed: boolean;
  onApprovalChange: (confirmed: boolean) => void;
  onShowPolicy?: () => void;
  policyReviewAcknowledged?: boolean;
  automationExecutionId?: string | null;
  automationError?: string | null;
  statusSyncError?: string | null;
  onRefreshExecution?: () => void;
  executionFetching?: boolean;
  runDisabled: boolean;
  runRunning: boolean;
  onRun: () => void;
  connectorFixNeeded?: boolean;
}) {
  const [techOpen, setTechOpen] = useState(false);
  const roleUrl = iamRoleConsoleUrl(roleTechnicalName, automationRegion);

  const reviewBody = (() => {
    if (policyLoading && isIamLeastPriv) {
      return "Checking least-privilege proposal…";
    }
    if (isIamLeastPriv) {
      return "SSM will apply the least-privilege policy replacement at high confidence. Review the plan and approve to proceed.";
    }
    return "SSM will apply the approved remediation in your AWS account. Review the plan and approve to proceed.";
  })();

  const step1Status: ChecklistStepStatus = (() => {
    if (isIamLeastPriv) {
      if (policyLoading) return "checking";
      if (policyReady || policyReviewAcknowledged) return "complete";
      return "pending";
    }
    return runnerReady ? "complete" : "pending";
  })();

  const step2Status: ChecklistStepStatus =
    execPhase === "running" || execPhase === "success" || approvalConfirmed ? "complete" : "pending";

  const step3Status: ChecklistStepStatus =
    execPhase === "success"
      ? "complete"
      : execPhase === "running"
        ? "running"
        : execPhase === "failed"
          ? "failed"
          : "pending";

  const step1Title = isIamLeastPriv ? "Validate policy" : "Review remediation plan";
  const step1Description = isIamLeastPriv
    ? "Review the recommended least-privilege policy"
    : documentTitle;

  const showRunButton = execPhase === "idle" || execPhase === "failed";

  const step1Footer =
    isIamLeastPriv && !policyLoading && !policyReady && !policyReviewAcknowledged && onShowPolicy ? (
      <button
        type="button"
        onClick={onShowPolicy}
        className="text-[12px] font-medium text-indigo-600 transition hover:text-indigo-800"
      >
        Show policy
      </button>
    ) : isIamLeastPriv && policyReady ? (
      <p className="text-[12px] text-emerald-700">High-confidence proposal ready.</p>
    ) : isIamLeastPriv && policyReviewAcknowledged && !policyReady ? (
      <p className="text-[12px] text-emerald-700">Policy reviewed.</p>
    ) : null;

  const step2Footer =
    execPhase === "idle" || execPhase === "failed" ? (
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={approvalConfirmed}
          onChange={(e) => onApprovalChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
        />
        <span className="text-[12px] leading-[18px] text-zinc-600">
          I confirm I have approval to apply this change
        </span>
      </label>
    ) : null;

  const step3Footer =
    execPhase === "running" && automationExecutionId ? (
      <div className="space-y-1.5 text-[12px] text-zinc-600">
        <p className="break-all font-mono text-[11px] text-zinc-500">{automationExecutionId}</p>
        {onRefreshExecution ? (
          <button
            type="button"
            disabled={executionFetching}
            onClick={onRefreshExecution}
            className="font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
          >
            {executionFetching ? "Refreshing…" : "Refresh status from AWS"}
          </button>
        ) : null}
        {statusSyncError ? (
          <p className="text-amber-800">Could not read status from AWS ({statusSyncError}).</p>
        ) : null}
      </div>
    ) : execPhase === "success" ? (
      <p className="text-[12px] text-emerald-700">Automation completed — verify the finding when ready.</p>
    ) : execPhase === "failed" && automationError ? (
      <p className="text-[12px] leading-relaxed text-amber-900">{formatAutomationStartError(automationError)}</p>
    ) : null;

  return (
    <div className="overflow-hidden rounded-xl border border-[#e6ebf2] bg-white shadow-sm shadow-zinc-950/[0.03]">
      <div className="p-4 sm:p-5">
        <div className="rounded-xl border border-[#e6ebf2] bg-[#f8f9fc] p-4">
          <div className="flex gap-3">
            <ExceptionDocIcon size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-5 text-zinc-900">
                Manual review required before automation
              </p>
              <p className="mt-1 text-[12px] leading-[17px] text-zinc-600">{reviewBody}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <SsmInlineStatusPill tone={inlineStatusTone}>{inlineStatusLabel}</SsmInlineStatusPill>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-[15px] font-semibold leading-5 text-zinc-900">Review checklist</p>
          <p className="mt-0.5 text-[13px] leading-5 text-zinc-500">
            Follow these steps before running the remediation.
          </p>

          <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 divide-y divide-zinc-100">
            <SsmChecklistStep
              step={1}
              title={step1Title}
              description={step1Description}
              status={step1Status}
              footer={step1Footer}
            />
            <SsmChecklistStep
              step={2}
              title="Confirm approvals"
              description="Obtain approval to apply the change"
              status={step2Status}
              footer={step2Footer}
            />
            <SsmChecklistStep
              step={3}
              title="Launch SSM automation"
              description="Run the remediation in your AWS account"
              status={step3Status}
              footer={step3Footer}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setTechOpen((v) => !v)}
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-zinc-500 outline-none transition hover:text-zinc-800 focus-visible:rounded focus-visible:ring-2 focus-visible:ring-indigo-200"
          aria-expanded={techOpen}
        >
          <svg
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${techOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
          </svg>
          {techOpen ? "Hide AWS details" : "Show AWS details"}
        </button>
        {techOpen ? (
          <div className={`mt-3 space-y-3 border-t border-zinc-100 pt-3 ${drawerBodyText}`}>
            <div>
              <p className={drawerEyebrow}>Automation document</p>
              <p className="mt-0.5 text-[13px] font-medium text-zinc-800">{documentTitle}</p>
              {documentUrl ? (
                <a
                  href={documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex break-all font-mono text-xs text-indigo-700 hover:underline"
                >
                  {documentTechnicalName}
                </a>
              ) : (
                <p className="mt-1 break-all font-mono text-xs text-zinc-700">{documentTechnicalName}</p>
              )}
            </div>
            <div>
              <p className={drawerEyebrow}>Execution role</p>
              <p className="mt-1 text-[13px] font-medium text-zinc-800">{roleTitle}</p>
              <a
                href={roleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-flex break-all font-mono text-xs text-indigo-700 hover:underline"
              >
                {roleTechnicalName}
              </a>
            </div>
          </div>
        ) : null}

        <div className="mt-4 space-y-3">
          {showRunButton ? (
            <SsmRunRemediationButton running={runRunning} disabled={runDisabled} onStart={onRun} />
          ) : null}
          {execPhase === "failed" && connectorFixNeeded ? (
            <Link
              to="/accounts"
              className="inline-flex rounded-lg border border-indigo-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-indigo-800 shadow-sm hover:bg-indigo-50"
            >
              Update AWS connector
            </Link>
          ) : null}
          {execPhase === "success" ? <SsmRemediationFlowHint phase="done" /> : null}
        </div>
      </div>
    </div>
  );
}

function SsmRunRemediationButton({
  running,
  disabled,
  onStart,
}: {
  running: boolean;
  disabled: boolean;
  onStart: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onStart}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-5 ${drawerBtnText} transition active:scale-[0.99] disabled:cursor-not-allowed ${
        disabled
          ? "border-zinc-200 bg-zinc-50 text-zinc-400 shadow-none"
          : "border-indigo-200 bg-indigo-50/50 text-indigo-700 shadow-sm shadow-indigo-950/[0.04] hover:border-indigo-300 hover:bg-indigo-50"
      }`}
    >
      {running ? (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600"
          aria-hidden
        />
      ) : (
        <svg
          className={`h-4 w-4 shrink-0 ${disabled ? "text-indigo-400" : "text-indigo-600"}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
        </svg>
      )}
      {running ? "Running…" : "Run remediation"}
    </button>
  );
}

function SsmRemediationFlowHint({ phase }: { phase: "running" | "done" }) {
  const step1Done = phase === "done";
  const step2Active = phase === "done";

  return (
    <div className="border-t border-indigo-100/60 pt-3">
      <p className="text-[11px] font-medium text-zinc-500">Next</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold ${
            step1Done ? "bg-zinc-100 text-zinc-600" : "bg-indigo-100 text-indigo-800 ring-1 ring-indigo-200/80"
          }`}
        >
          1 Run remediation
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-zinc-400" aria-hidden>
          <span className="h-px w-5 bg-zinc-300" />
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
        </span>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold ${
            step2Active
              ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80"
              : "bg-zinc-100 text-zinc-500"
          }`}
        >
          2 Verify fix
        </span>
      </div>
    </div>
  );
}

function SsmStatusBadge({
  tone,
  children,
}: {
  tone: "ready" | "loading" | "blocked" | "failed" | "running" | "completed";
  children: React.ReactNode;
}) {
  const toneClass = {
    ready: "bg-emerald-50 text-emerald-800 ring-emerald-200/80",
    loading: "bg-zinc-100 text-zinc-600 ring-zinc-200/80",
    blocked: "bg-amber-50 text-amber-900 ring-amber-200/80",
    failed: "bg-amber-50 text-amber-900 ring-amber-200/80",
    running: "bg-indigo-50 text-indigo-800 ring-indigo-200/80",
    completed: "bg-emerald-50 text-emerald-800 ring-emerald-200/80",
  }[tone];

  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${toneClass}`}>
      {children}
    </span>
  );
}

function SsmRemediationPanel({
  findingId,
  checkId,
  accountId,
  resourceArn,
  resourceRegion,
  resourceLabel,
  ssm,
  onShowPolicy,
  policyReviewAcknowledged,
}: {
  findingId: string;
  checkId: string;
  accountId: string | null;
  resourceArn?: string | null;
  resourceRegion: string;
  resourceLabel: string;
  ssm: SsmRemediationMeta;
  onShowPolicy?: () => void;
  policyReviewAcknowledged?: boolean;
}) {
  const [dispatch, setDispatch] = useState<DispatchResponse | null>(null);
  const [cloudTrailBucketName, setCloudTrailBucketName] = useState("");
  const [cloudTrailName, setCloudTrailName] = useState("VeritrailCloudTrail");
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  /** True after user clicks Run remediation this drawer session (avoids stale DB failures on Ready). */
  const [attemptedStart, setAttemptedStart] = useState(false);
  const qc = useQueryClient();
  const isCloudTrailCreate = checkId === "cloudtrail.trail.not_enabled";
  const isIamLeastPriv = checkId === IAM_LEAST_PRIVILEGE_CHECK;

  const {
    data: generatedPolicy,
    isLoading: policyLoading,
    refetch: refetchGeneratedPolicy,
  } = useQuery({
    queryKey: ["generated-policy", accountId, resourceArn],
    queryFn: () =>
      api<{
        confidence?: "high" | "medium" | "low";
        confidence_note?: string | null;
        improve_via_cloudtrail?: boolean;
        cloudtrail_analysis?: {
          ready: boolean;
          status: "ready" | "no_trail" | "advanced_disabled" | "no_connector";
          message?: string | null;
        };
        access_analyzer?: { reason?: string | null };
        observed_action_count?: number;
        source_label?: string | null;
        cleaned_policies?: Record<string, unknown> | null;
      }>(
        `/v1/accounts/${accountId}/roles/generated-policy?role_arn=${encodeURIComponent(resourceArn!)}&advanced=true`,
        {
          schema: generatedPolicySchema as unknown as z.ZodType<{
            confidence?: "high" | "medium" | "low";
            confidence_note?: string | null;
            improve_via_cloudtrail?: boolean;
            cloudtrail_analysis?: {
              ready: boolean;
              status: "ready" | "no_trail" | "advanced_disabled" | "no_connector";
              message?: string | null;
            };
            access_analyzer?: { reason?: string | null };
            observed_action_count?: number;
            source_label?: string | null;
            cleaned_policies?: Record<string, unknown> | null;
          }>,
        },
      ),
    enabled: isIamLeastPriv && !!accountId && !!resourceArn,
    staleTime: 0,
  });

  const policyReady = !isIamLeastPriv || generatedPolicy?.confidence === "high";

  const { data: runnerStatus, isLoading: runnerLoading } = useQuery({
    queryKey: ["remediation-runner-status", accountId, checkId, resourceRegion],
    queryFn: () =>
      api<RunnerStatus>(
        `/v1/accounts/${accountId}/remediation-runner/status?check_id=${encodeURIComponent(checkId)}&resource_region=${encodeURIComponent(resourceRegion)}`,
        { schema: remediationRunnerStatusSchema as unknown as z.ZodType<RunnerStatus> },
      ),
    enabled: !!accountId && ssm.module_enabled,
    staleTime: 60_000,
  });

  const { data: persistedExecution, isFetching: executionFetching } = useRemediationExecution(findingId);

  const startMutation = useMutation({
    mutationFn: () =>
      api<DispatchResponse>(`/v1/findings/${findingId}/remediation/dispatch`, {
        method: "POST",
        body: JSON.stringify({
          execute: true,
          ...(isCloudTrailCreate
            ? {
                parameter_overrides: {
                  TrailName: cloudTrailName.trim() || "VeritrailCloudTrail",
                  S3BucketName: cloudTrailBucketName.trim(),
                },
              }
            : {}),
        }),
      }),
    onSuccess: (res) => {
      setDispatch(res);
      setAttemptedStart(true);
      void qc.invalidateQueries({ queryKey: ["remediation-execution", findingId] });
    },
  });

  useEffect(() => {
    setDispatch(null);
    setAttemptedStart(false);
    setApprovalConfirmed(false);
    setCloudTrailBucketName("");
    setCloudTrailName("VeritrailCloudTrail");
  }, [findingId]);

  useEffect(() => {
    if (!persistedExecution || persistedExecution.status === "none") return;
    const active =
      persistedExecution.status === "running" ||
      persistedExecution.status === "dispatched" ||
      Boolean(persistedExecution.automation_execution_id);
    if (active) {
      setAttemptedStart(true);
      if (persistedExecution.automation_execution_id) {
        setDispatch((prev) => {
          if (prev?.automation_execution_id === persistedExecution.automation_execution_id) return prev;
          return {
            ...(prev ?? {}),
            plan_id: persistedExecution.plan_id,
            automation_execution_id: persistedExecution.automation_execution_id,
            automation_error: persistedExecution.error ?? null,
            executed: true,
          } as DispatchResponse;
        });
      }
    } else if (persistedExecution.status === "failed" && persistedExecution.error) {
      setAttemptedStart(true);
      setDispatch((prev) => {
        if (prev?.automation_error === persistedExecution.error && !prev?.automation_execution_id) return prev;
        return {
          ...(prev ?? {}),
          plan_id: persistedExecution.plan_id,
          automation_execution_id: null,
          automation_error: persistedExecution.error ?? "automation_start_failed",
          executed: false,
        } as DispatchResponse;
      });
    }
  }, [findingId, persistedExecution]);

  if (!ssm.module_enabled) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[13px] font-semibold text-zinc-900">Automated fix</p>
            <p className="mt-1 text-[12px] leading-relaxed text-amber-950">
              Enable <span className="font-semibold">{ssm.module_label}</span> in the AWS connector first.
            </p>
          </div>
          <SsmStatusBadge tone="blocked">Not enabled</SsmStatusBadge>
        </div>
        <Link
          to="/accounts"
          className="mt-3 inline-flex rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-indigo-800 shadow-sm hover:border-indigo-300 hover:bg-indigo-50"
        >
          Update AWS connector
        </Link>
      </div>
    );
  }

  const ready = runnerStatus?.ready === true;
  const running = startMutation.isPending;
  const execStatus = persistedExecution?.status;
  const execSuccess =
    execStatus === "success" || Boolean((persistedExecution?.result as { ok?: boolean } | undefined)?.ok);
  const execFailedPersisted = execStatus === "failed" && Boolean(persistedExecution?.error);
  const execInProgress =
    (execStatus === "running" || execStatus === "dispatched") && !execSuccess && !execFailedPersisted;
  const statusSyncError = persistedExecution?.status_sync?.error ?? null;
  const automationExecutionId =
    dispatch?.automation_execution_id ?? persistedExecution?.automation_execution_id ?? null;
  const automationError =
    dispatch?.automation_error ?? persistedExecution?.error ?? null;
  const failedPlanId = dispatch?.plan_id ?? persistedExecution?.plan_id ?? null;

  const hasAutomationError = Boolean(automationError);
  const executionStartFailed = hasAutomationError && !automationExecutionId;
  const executionRunFailed =
    hasAutomationError && Boolean(automationExecutionId) && !execInProgress && !execSuccess;

  const started =
    Boolean(automationExecutionId) || execInProgress || execSuccess;
  const showFailedState = executionStartFailed || executionRunFailed;
  const provider: "aws-owned" | "veritrail" =
    ssm.automation_provider ??
    (ssm.runbook?.owner === "aws" ? "aws-owned" : "veritrail");
  const runbookLabel =
    provider === "aws-owned"
      ? ssm.aws_document_name ?? ssm.runbook?.document_name ?? "AWS runbook"
      : ssm.runbook?.document_name ?? "Veritrail exact-match runbook";
  const runbookSourceUrl =
    provider === "aws-owned"
      ? ssm.aws_runbook_docs_url ?? ssm.runbook?.source_url
      : ssm.runbook?.source_url;
  const planLabels = ssmHumanPlanLabels(checkId, provider);
  const cloudTrailInputsReady = !isCloudTrailCreate || cloudTrailBucketName.trim().length > 2;

  const statusChecking = runnerLoading || (isIamLeastPriv && policyLoading);

  const inlineStatusTone: "checking" | "blocked" | "ready" | "not_ready" = statusChecking
    ? "checking"
    : ready && isIamLeastPriv && !policyReady
      ? "blocked"
      : ready
        ? "ready"
        : "not_ready";
  const inlineStatusLabel = statusChecking
    ? "Checking"
    : ready && isIamLeastPriv && !policyReady
      ? "High confidence required"
      : ready
        ? "Ready to run"
        : "Not ready";

  const execPhase: SsmExecPhase = execSuccess
    ? "success"
    : execInProgress || running
      ? "running"
      : showFailedState
        ? "failed"
        : "idle";

  const workflowRunDisabled =
    running ||
    !accountId ||
    !cloudTrailInputsReady ||
    !policyReady ||
    !approvalConfirmed;

  const connectorFixNeeded = Boolean(
    showFailedState &&
      automationError &&
      (automationError.includes("StartAutomationExecution") ||
        automationError.includes("PutPublicAccessBlock")),
  );

  return (
    <div className="space-y-3">
          {statusChecking && !ready && (
            <p className="text-[12px] text-zinc-500">
              {policyLoading && isIamLeastPriv
                ? "Checking automation and least-privilege proposal…"
                : "Checking automation in your account…"}
            </p>
          )}

          {!runnerLoading && !ready && runnerStatus && (
            <div className="rounded-xl border border-amber-200/70 bg-amber-50/80 px-3 py-2.5 text-[12px] leading-relaxed text-amber-950">
              <p className="font-semibold">Automation is not ready in your account.</p>
              <ul className="mt-2 list-disc space-y-1.5 pl-4 text-zinc-700 marker:text-amber-600">
                {runnerStatus.blockers.map((b) => (
                  <li key={b} className="break-words">
                    {b}
                  </li>
                ))}
              </ul>
              <Link
                to="/accounts"
                className="mt-3 inline-flex rounded-lg border border-indigo-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-indigo-800 shadow-sm hover:bg-indigo-50"
              >
                Update AWS connector
              </Link>
            </div>
          )}

          {!runnerLoading && ready && (
            <div className="space-y-4">
              <SsmAutomationWorkflowCard
                isIamLeastPriv={isIamLeastPriv}
                policyLoading={policyLoading}
                policyReady={policyReady}
                inlineStatusTone={inlineStatusTone}
                inlineStatusLabel={inlineStatusLabel}
                documentTitle={planLabels.documentTitle}
                documentUrl={runbookSourceUrl}
                documentTechnicalName={runbookLabel}
                roleTitle={planLabels.roleTitle}
                roleTechnicalName={ssm.automation_role_name}
                automationRegion={ssm.automation_region}
                execPhase={execPhase}
                runnerReady={ready}
                approvalConfirmed={approvalConfirmed}
                onApprovalChange={setApprovalConfirmed}
                onShowPolicy={onShowPolicy}
                policyReviewAcknowledged={policyReviewAcknowledged}
                automationExecutionId={automationExecutionId}
                automationError={automationError}
                statusSyncError={statusSyncError}
                onRefreshExecution={() => void refreshRemediationExecution(qc, findingId)}
                executionFetching={executionFetching}
                runDisabled={workflowRunDisabled}
                runRunning={running}
                onRun={() => {
                  setAttemptedStart(true);
                  startMutation.mutate();
                }}
                connectorFixNeeded={connectorFixNeeded}
              />
              {isCloudTrailCreate && (
                <div className="rounded-2xl border border-sky-100 bg-sky-50/45 p-4">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-sky-700 ring-1 ring-sky-100">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 7.5h16.5M6 7.5V18a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 18V7.5M8.25 7.5V6A2.25 2.25 0 0 1 10.5 3.75h3A2.25 2.25 0 0 1 15.75 6v1.5" />
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-zinc-950">CloudTrail log destination</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-zinc-600">
                        Use an existing central log bucket, or create a dedicated CloudTrail bucket first. The AWS runbook needs this bucket before it can create the trail.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[1.3fr_1fr]">
                    <label className="block">
                      <span className="text-[11px] font-semibold text-zinc-700">S3 log bucket</span>
                      <input
                        value={cloudTrailBucketName}
                        onChange={(e) => setCloudTrailBucketName(e.target.value)}
                        placeholder="company-cloudtrail-logs"
                        className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-semibold text-zinc-700">Trail name</span>
                      <input
                        value={cloudTrailName}
                        onChange={(e) => setCloudTrailName(e.target.value)}
                        placeholder="VeritrailCloudTrail"
                        className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                      />
                    </label>
                  </div>
                  {!cloudTrailInputsReady && (
                    <p className="mt-2 text-[11px] font-medium text-amber-800">
                      Enter a bucket name to run this guided remediation.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

      {!attemptedStart && !showFailedState && !execSuccess && (
        <PreviousExecutionNote findingId={findingId} />
      )}

      {!showFailedState && !execSuccess && !(started && !executionRunFailed) && (
        <ExecutionStatus
          findingId={findingId}
          showStaleFailures={attemptedStart}
          onRefresh={() => void refreshRemediationExecution(qc, findingId)}
          isRefreshing={executionFetching}
        />
      )}
    </div>
  );
}

export function IaCRemediationSection({
  findingId,
  checkId,
  embedMode,
  accountId,
  accountProvider = "aws",
  resourceRegion,
  resourceArn,
  resourceLabel,
  onShowPolicy,
  policyReviewAcknowledged,
}: {
  findingId: string;
  checkId: string;
  bucketName?: string;
  embedMode: "terraform" | "automation";
  accountId?: string | null;
  accountProvider?: FindingScopeProvider;
  resourceRegion?: string | null;
  resourceArn?: string | null;
  resourceLabel?: string;
  onShowPolicy?: () => void;
  policyReviewAcknowledged?: boolean;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["iac-snippets", findingId],
    queryFn: () =>
      api<IaCResponse>(`/v1/findings/${findingId}/iac-snippets`, {
        schema: iacSnippetsSchema as unknown as z.ZodType<IaCResponse>,
      }),
  });

  const { data: iacRepo } = useQuery({
    queryKey: ["iac-repository-integration"],
    queryFn: () => api("/v1/integrations/iac-repository", { schema: iacRepositoryIntegrationSchema }),
    staleTime: 60_000,
    enabled: embedMode === "terraform",
  });

  if (isLoading) {
    return <p className="text-[13px] text-zinc-500">Loading remediation templates…</p>;
  }
  if (error || !data) {
    return <p className="text-[13px] text-zinc-600">Could not load IaC snippets.</p>;
  }

  if (embedMode === "terraform") {
    if (
      data.iac_status === "automation_only" ||
      !data.apply_paths?.terraform_generic ||
      !data.terraform
    ) {
      return (
        <p className="text-[13px] leading-relaxed text-zinc-600">
          {data.reason ?? "No IaC template for this check yet — use Console or CLI instead."}
        </p>
      );
    }

    const providers = data.pr_automation?.providers ?? [];
    const iacRepoConnected = !!iacRepo?.connected;
    const vcsConnected =
      !!data.pr_automation?.github_connected || !!data.pr_automation?.gitlab_connected;
    const showPrPaused = iacRepoConnected && vcsConnected && !data.apply_paths?.terraform_pr;
    const showPrReady =
      iacRepoConnected && data.apply_paths?.terraform_pr && data.pr_automation?.github_connected;

    return (
      <div className="space-y-4">
        {showPrPaused && (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] leading-relaxed text-zinc-600">
            <span className="font-semibold text-zinc-800">
              {versionControlPrLabel(providers)}
            </span>{" "}
            automation is paused for this check — copy Terraform below or use Remediation → Automation.
          </p>
        )}
        {showPrReady && data.pr_automation?.repos?.[0] && (
          <p className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-[11px] text-indigo-950">
            Repo-aware PRs use <span className="font-semibold">hclpatch</span> +{" "}
            <span className="font-semibold">terraform validate</span> — call{" "}
            <code className="text-[11px]">POST /v1/findings/…/iac/terraform-pr</code> with a connected repo.
          </p>
        )}

        <div>
          <p className="text-[12px] font-semibold text-zinc-800">Terraform</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Runnable module for this finding — <code className="text-[11px]">terraform init</code> then{" "}
            <code className="text-[11px]">terraform apply</code> (AWS CLI + credentials required).
          </p>
          <CopyBlock label="remediation.tf" text={data.terraform} />
        </div>

        {data.hints?.map((h) => (
          <p key={h} className="text-[11px] text-zinc-500">
            {h}
          </p>
        ))}
      </div>
    );
  }

  if (accountProvider !== "aws") {
    return (
      <p className="text-[13px] leading-relaxed text-zinc-600">
        {automatedRemediationUnavailableCopy(accountProvider)}
      </p>
    );
  }

  if (!data.apply_paths?.customer_automation) {
    return (
      <p className="text-[13px] leading-relaxed text-zinc-600">
        {automatedRemediationUnavailableCopy("aws")}
      </p>
    );
  }

  if (!data.ssm_remediation) {
    return (
      <p className="text-[13px] leading-relaxed text-zinc-600">
        {automatedRemediationUnavailableCopy("aws", "metadata")}
      </p>
    );
  }

  const region =
    resourceRegion ??
    data.ssm_remediation.resource_region ??
    data.ssm_remediation.automation_region ??
    "us-east-1";

  return (
    <SsmRemediationPanel
      findingId={findingId}
      checkId={checkId}
      accountId={accountId ?? null}
      resourceArn={resourceArn ?? null}
      resourceRegion={region}
      resourceLabel={resourceLabel ?? "this resource"}
      ssm={data.ssm_remediation}
      onShowPolicy={onShowPolicy}
      policyReviewAcknowledged={policyReviewAcknowledged}
    />
  );
}

/** Prior failed run when the panel is Ready again (not this session). */
function PreviousExecutionNote({ findingId }: { findingId: string }) {
  const { data } = useRemediationExecution(findingId);
  if (!data || data.status !== "failed" || !data.error) return null;
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] leading-relaxed text-zinc-600">
      <p className="font-semibold text-zinc-700">Previous attempt (not this session)</p>
      <p className="mt-1 text-zinc-600">{formatAutomationStartError(data.error)}</p>
      {data.plan_id && (
        <p className="mt-1 font-mono text-[11px] text-zinc-500">Plan {data.plan_id.slice(0, 8)}…</p>
      )}
    </div>
  );
}

function ExecutionStatus({
  findingId,
  showStaleFailures,
  onRefresh,
  isRefreshing,
}: {
  findingId: string;
  /** When false, hide terminal failed records from before this drawer session. */
  showStaleFailures: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}) {
  const { data } = useRemediationExecution(findingId);
  if (!data || data.status === "none") return null;
  const ok = data.status === "success" || data.result?.ok;
  const failed = data.status === "failed";
  const inProgress = data.status === "running";
  const dispatchedOnly = data.status === "dispatched";
  const terminal = failed || ok;
  if (terminal && !showStaleFailures) return null;
  if (dispatchedOnly && !data.error && !showStaleFailures) return null;
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-[12px] ${
        ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : failed
            ? "border-amber-200 bg-amber-50/80 text-amber-950"
            : "border-zinc-200 bg-zinc-50 text-zinc-700"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 leading-relaxed">
          {ok ? (
            <>
              Run <span className="font-semibold">completed</span>
            </>
          ) : failed ? (
            <>
              Run <span className="font-semibold">did not start</span>
            </>
          ) : inProgress ? (
            <>
              Run <span className="font-semibold">in progress</span>
            </>
          ) : (
            <>
              Run <span className="font-semibold">{data.status}</span>
            </>
          )}
          {data.plan_id && (
            <>
              {" "}
              · plan <span className="font-mono text-[11px]">{data.plan_id.slice(0, 8)}…</span>
            </>
          )}
          {data.error && (
            <span className="mt-1 block text-[11px] leading-snug opacity-90">
              {formatAutomationStartError(data.error)}
            </span>
          )}
        </p>
        {inProgress && onRefresh && (
          <button
            type="button"
            disabled={isRefreshing}
            onClick={onRefresh}
            className="shrink-0 text-[11px] font-medium text-indigo-700 underline disabled:opacity-50"
          >
            {isRefreshing ? "Refreshing…" : "Refresh status"}
          </button>
        )}
      </div>
    </div>
  );
}
