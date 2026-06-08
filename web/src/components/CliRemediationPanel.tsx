import { useMemo, useState } from "react";
import {
  drawerBodyText,
  drawerBtnText,
  drawerCardTitle,
  drawerPanel,
} from "./drawerStyles";
import type { CliRemediationPlan } from "../lib/cliRemediationPlan";
import { allExecutableCommands } from "../lib/cliRemediationPlan";

function CliCommandBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const lines = code.split("\n");

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200/90 bg-zinc-50/90 ring-1 ring-zinc-100">
      <div className="flex items-center justify-end border-b border-zinc-200/80 bg-white/80 px-3 py-1.5">
        <button
          type="button"
          onClick={copy}
          className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
            copied ? "text-emerald-600" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
          }`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-1 py-3 font-mono text-[12px] leading-[1.75] text-zinc-800">
        {lines.map((line, index) => (
          <div key={index} className="flex min-w-max">
            <span className="w-9 shrink-0 select-none pr-2 text-right text-zinc-400">{index + 1}</span>
            <code className="min-w-0 whitespace-pre">{line || " "}</code>
          </div>
        ))}
      </pre>
    </div>
  );
}

export function CliRemediationPanel({ plan }: { plan: CliRemediationPlan }) {
  const [copiedAll, setCopiedAll] = useState(false);
  const allCommands = useMemo(() => allExecutableCommands(plan), [plan]);

  const copyAll = () => {
    if (!allCommands) return;
    void navigator.clipboard.writeText(allCommands).then(() => {
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 1800);
    });
  };

  if (plan.steps.length === 0) {
    return <p className={drawerBodyText}>No CLI commands available for this finding.</p>;
  }

  return (
    <div className={`${drawerPanel} overflow-hidden`}>
      <div className="flex items-center justify-between gap-3 border-b border-[#eef2f6] bg-[#f8fafc] px-4 py-3">
        <h4 className={drawerCardTitle}>AWS CLI commands</h4>
        <button
          type="button"
          onClick={copyAll}
          disabled={!allCommands}
          className={`inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 ${drawerBtnText} text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50`}
        >
          <svg className="h-3.5 w-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2m-6 12h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2Z" />
          </svg>
          {copiedAll ? "Copied" : "Copy all"}
        </button>
      </div>

      <div className="space-y-6 px-4 py-4">
        {plan.steps.map((step) => (
          <div key={step.id} className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-[11px] font-bold text-indigo-700">
                {step.id}
              </span>
              <h5 className="text-[13px] font-semibold text-zinc-900">
                {step.title}
                {step.recommended ? (
                  <span className="ml-1.5 font-normal text-zinc-500">(recommended)</span>
                ) : null}
              </h5>
            </div>
            {step.description ? (
              <p className={`pl-8 ${drawerBodyText}`}>{step.description}</p>
            ) : null}
            <div className="space-y-3 pl-8">
              {step.commands.map((command, index) => (
                <CliCommandBlock key={`${step.id}-${index}`} code={command} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
