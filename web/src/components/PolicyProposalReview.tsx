import { useState, type ReactNode } from "react";
import {
  drawerBodyText,
  drawerBtnText,
  drawerCardTitle,
  drawerChip,
  drawerHelperText,
  drawerPanel,
  drawerSectionBody,
  drawerSectionHead,
} from "./drawerStyles";

export type GeneratedPolicySnapshot = {
  coverage?: { actions?: boolean; resources?: boolean };
  preserved_service_wildcards?: string[];
  observed_action_count?: number;
  used_actions?: string[];
  confidence?: "high" | "medium" | "low";
  access_analyzer?: {
    available?: boolean;
    reason?: string | null;
    job_id?: string | null;
    completed_on?: string | null;
    has_concrete_resources?: boolean;
    placeholder_resources_ignored?: number;
    placeholder_resources?: string[];
  };
};

const CONFIDENCE_PILL: Record<string, string> = {
  high: "border-emerald-200 bg-emerald-50 text-emerald-900",
  medium: "border-amber-200 bg-amber-50 text-amber-900",
  low: "border-zinc-300 bg-zinc-100 text-zinc-700",
};

function ProposalCard({
  title,
  subtitle,
  icon,
  headerAction,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className={`${drawerPanel} overflow-hidden`}>
      <div className={`${drawerSectionHead} flex items-center justify-between gap-3`}>
        <div className="flex min-w-0 items-center gap-2.5">
          {icon}
          <div className="min-w-0">
            <h4 className={drawerCardTitle}>{title}</h4>
            {subtitle ? <p className={`mt-0.5 ${drawerHelperText}`}>{subtitle}</p> : null}
          </div>
        </div>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </div>
      <div className={`${drawerSectionBody} space-y-3`}>{children}</div>
      {footer ? <div className="border-t border-[#eef2f6] bg-[#fafbfc] px-4 py-3.5">{footer}</div> : null}
    </div>
  );
}

function WhyRow({ icon, tone, children }: { icon: ReactNode; tone: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone}`}
      >
        {icon}
      </span>
      <p className={`min-w-0 flex-1 pt-0.5 ${drawerBodyText}`}>{children}</p>
    </li>
  );
}

export function PolicyProposalReviewLayout({
  data,
  validationFooter,
  technicalDetails,
}: {
  data: GeneratedPolicySnapshot;
  validationFooter?: ReactNode;
  technicalDetails?: ReactNode;
}) {
  const [techOpen, setTechOpen] = useState(false);
  const cov = data.coverage ?? { actions: (data.used_actions?.length ?? 0) > 0, resources: false };
  const preserved = data.preserved_service_wildcards ?? [];
  const observed =
    data.observed_action_count ??
    (data.used_actions?.filter((a) => !a.endsWith(":*") && a !== "*").length ?? 0);
  const hasConcreteResources = data.access_analyzer?.has_concrete_resources ?? cov.resources;

  const confidenceBadge = data.confidence ? (
    <span
      className={`rounded-full border px-2.5 py-1 ${drawerChip} capitalize ${
        CONFIDENCE_PILL[data.confidence] ?? CONFIDENCE_PILL.low
      }`}
    >
      {data.confidence} confidence
    </span>
  ) : null;

  const snapshotDescription = hasConcreteResources ? (
    <>
      This proposal narrows the <span className="font-semibold text-[#1D2939]">action scope</span> and{" "}
      <span className="font-semibold text-[#1D2939]">resource scope</span> based on observed usage.
    </>
  ) : (
    <>
      This proposal narrows the <span className="font-semibold text-[#1D2939]">action scope</span> based on
      observed usage while keeping the <span className="font-semibold text-[#1D2939]">resource scope</span>{" "}
      broad.
    </>
  );

  const whyItems: { key: string; tone: string; icon: ReactNode; text: ReactNode }[] = [];

  if (observed > 0 || preserved.length > 0) {
    whyItems.push({
      key: "usage",
      tone: "bg-sky-50 text-sky-600",
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
        </svg>
      ),
      text: "AWS reported recent usage for preserved services.",
    });
  }

  if (!hasConcreteResources && observed > 0) {
    whyItems.push({
      key: "detail",
      tone: "bg-indigo-50 text-indigo-600",
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
        </svg>
      ),
      text: "For some preserved services, AWS did not return action or resource-level detail.",
    });
  }

  if (!hasConcreteResources) {
    whyItems.push({
      key: "wildcard",
      tone: "bg-emerald-50 text-emerald-600",
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
        </svg>
      ),
      text: (
        <>
          Therefore, <span className="font-mono text-[13px]">Resource</span> remains * where needed.
        </>
      ),
    });
  }

  if (whyItems.length === 0) {
    whyItems.push({
      key: "review",
      tone: "bg-zinc-100 text-zinc-600",
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
        </svg>
      ),
      text: "Review the suggested policy against your workload before applying.",
    });
  }

  const actionSummary =
    observed > 0
      ? (
          <>
            <span className="font-semibold text-[#1D2939]">Action:</span> * was replaced with {observed} observed
            actions.
          </>
        )
      : (
          <>
            <span className="font-semibold text-[#1D2939]">Action:</span> * scope reviewed from recorded usage.
          </>
        );

  const resourceSummary = cov.resources ? (
    <>
      <span className="font-semibold text-[#1D2939]">Resource</span> scope includes concrete ARNs where available.
    </>
  ) : (
    <>
      <span className="font-semibold text-[#1D2939]">Resource</span> remains *.
    </>
  );

  return (
    <div className="space-y-4">
      <ProposalCard title="Policy snapshot" headerAction={confidenceBadge}>
        <div className="flex flex-wrap gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 ${drawerChip} ${
              cov.actions && observed > 0
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            {cov.actions && observed > 0 ? `✓ ${observed} actions scoped` : "✗ Actions not scoped"}
          </span>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 ${drawerChip} ${
              cov.resources
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-zinc-200 bg-zinc-100 text-zinc-700"
            }`}
          >
            {cov.resources ? "✓ Resource scope applied" : "✕ Resources unchanged"}
          </span>
        </div>
        <p className={drawerBodyText}>{snapshotDescription}</p>
      </ProposalCard>

      <ProposalCard
        title="Why this proposal"
        icon={
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
            </svg>
          </span>
        }
      >
        <ul className="space-y-3.5">
          {whyItems.map((item) => (
            <WhyRow key={item.key} icon={item.icon} tone={item.tone}>
              {item.text}
            </WhyRow>
          ))}
        </ul>
      </ProposalCard>

      <ProposalCard
        title="Validate"
        subtitle="CloudTrail checks resource ARNs from recorded usage"
        icon={
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
          </span>
        }
        footer={validationFooter}
      >
        <div className={`space-y-2 ${drawerBodyText}`}>
          <p>{actionSummary}</p>
          <p>{resourceSummary}</p>
        </div>
      </ProposalCard>

      {technicalDetails ? (
        <div className={`${drawerPanel} overflow-hidden`}>
          <button
            type="button"
            onClick={() => setTechOpen((o) => !o)}
            className={`flex w-full items-center px-4 py-3 text-left transition ${
              techOpen ? "border-b border-[#eef2f6] bg-[#f8fafc]" : "bg-white hover:bg-[#f8fafc]/80"
            }`}
            aria-expanded={techOpen}
          >
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${drawerChip} transition ${
                techOpen
                  ? "border-zinc-300 bg-zinc-200/80 text-zinc-800"
                  : "border-zinc-200 bg-zinc-100 text-zinc-700"
              }`}
            >
              <svg
                className={`h-3 w-3 shrink-0 transition-transform ${techOpen ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
              </svg>
              {techOpen ? "Hide technical details" : "Show technical details"}
            </span>
          </button>
          {techOpen ? technicalDetails : null}
        </div>
      ) : null}
    </div>
  );
}

export function PolicyValidationFooter({
  metaLine,
  action,
}: {
  metaLine?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {metaLine ? (
        <p className={`flex items-center gap-2 ${drawerHelperText} text-zinc-500`}>
          <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          {metaLine}
        </p>
      ) : (
        <span />
      )}
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PolicyOutlineButton({
  children,
  disabled,
  onClick,
  spinning,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  spinning?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-[10px] border border-indigo-200 bg-white px-3.5 py-2 ${drawerBtnText} text-indigo-900 shadow-sm shadow-zinc-900/[0.02] transition hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {spinning ? (
        <svg className="h-3.5 w-3.5 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24" aria-hidden>
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : null}
      {children}
    </button>
  );
}
