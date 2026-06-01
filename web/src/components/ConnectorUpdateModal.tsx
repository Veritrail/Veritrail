import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { CONNECTOR_STACK_NAME } from "../lib/connectionPosture";
import type { RemediationModules } from "../data/remediationModules";

type ConnectorUpdateAccount = {
  id: string;
  cfn_stack_name: string;
  cfn_template_version: string | null;
  enable_advanced_policy_generation: boolean;
  remediation_modules: RemediationModules;
};

type ConnectorVersion = {
  tag: string;
  label: string;
  status: string;
  notes: string;
  template_url: string;
};

type ConnectorVersionsResponse = {
  recommended_version_tag: string;
  versions: ConnectorVersion[];
};

type ConnectorUpdateArtifacts = {
  version_tag: string;
  version_label: string;
  template_url: string;
  stack_name: string;
  console_stack_url: string;
  update_cli_command: string;
  current_version_tag: string | null;
  recommended_version_tag: string;
};

export function ConnectorUpdateModal({
  acc,
  open,
  onClose,
}: {
  acc: ConnectorUpdateAccount;
  open: boolean;
  onClose: () => void;
}) {
  const opts = {
    enable_advanced_policy_generation: acc.enable_advanced_policy_generation,
    remediation_modules: acc.remediation_modules,
  };
  const versionsQuery = useQuery({
    queryKey: ["connector-versions"],
    queryFn: () => api<ConnectorVersionsResponse>("/v1/accounts/connector-versions"),
    enabled: open,
    staleTime: 60_000,
  });

  const recommended = versionsQuery.data?.recommended_version_tag ?? "v2";
  const [selectedTag, setSelectedTag] = useState(recommended);

  useEffect(() => {
    if (!open) return;
    setSelectedTag(versionsQuery.data?.recommended_version_tag ?? "v2");
  }, [open, versionsQuery.data?.recommended_version_tag]);

  const artifactsQuery = useQuery({
    queryKey: [
      "connector-update",
      acc.id,
      selectedTag,
      opts.enable_advanced_policy_generation,
      opts.remediation_modules,
    ],
    queryFn: () =>
      api<ConnectorUpdateArtifacts>(
        `/v1/accounts/${acc.id}/connector-update?version_tag=${encodeURIComponent(selectedTag)}`,
      ),
    enabled: open && !!selectedTag,
  });

  const versions = versionsQuery.data?.versions ?? [];
  const selectedVersion = useMemo(
    () => versions.find((v) => v.tag === selectedTag),
    [versions, selectedTag],
  );

  const [copied, setCopied] = useState(false);

  async function copyCli() {
    const cmd = artifactsQuery.data?.update_cli_command;
    if (!cmd) return;
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[250] flex items-end justify-center bg-zinc-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connector-update-title"
    >
      <div className="flex max-h-[min(90vh,44rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/15">
        <div className="border-b border-zinc-100 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="connector-update-title" className="text-base font-semibold text-zinc-900">
                Update connector
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600">
                Update stack{" "}
                <span className="font-mono text-zinc-800">{acc.cfn_stack_name || CONNECTOR_STACK_NAME}</span>{" "}
                in place — same stack name and <span className="font-mono">{CONNECTOR_STACK_NAME}</span> role.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Current</p>
              <p className="mt-1 text-sm font-semibold text-zinc-900">
                {artifactsQuery.data?.current_version_tag
                  ? artifactsQuery.data.current_version_tag
                  : "Not recorded"}
              </p>
              {acc.cfn_template_version && (
                <p className="mt-0.5 text-xs text-zinc-500">Release {acc.cfn_template_version}</p>
              )}
            </div>
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">Recommended</p>
              <p className="mt-1 text-sm font-semibold text-indigo-950">{recommended}</p>
              <p className="mt-0.5 text-xs text-indigo-900/70">
                {versions.find((v) => v.tag === recommended)?.label ?? "Latest approved connector"}
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-zinc-700">Approved version</p>
            {versionsQuery.isLoading && (
              <p className="mt-2 text-sm text-zinc-500">Loading versions…</p>
            )}
            {versionsQuery.isError && (
              <p className="mt-2 text-sm text-red-600">Could not load approved versions.</p>
            )}
            <div className="mt-2 space-y-2">
              {versions.map((v) => (
                <label
                  key={v.tag}
                  className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-3 transition ${
                    selectedTag === v.tag
                      ? "border-indigo-300 bg-indigo-50/50 ring-1 ring-indigo-200/80"
                      : "border-zinc-200 hover:border-zinc-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="connector-version"
                    className="mt-1"
                    checked={selectedTag === v.tag}
                    onChange={() => setSelectedTag(v.tag)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900">{v.label}</span>
                      <span className="font-mono text-xs text-zinc-500">{v.tag}</span>
                      {v.status === "recommended" && (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-800">
                          Recommended
                        </span>
                      )}
                    </span>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-600">{v.notes}</p>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {selectedVersion && (
            <p className="text-[11px] leading-relaxed text-zinc-500 break-all">
              Template: <span className="font-mono text-zinc-700">{selectedVersion.template_url}</span>
            </p>
          )}

          <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-3 py-2.5 text-xs text-zinc-600">
            <p className="font-semibold text-zinc-800">Parameters included in CLI</p>
            <ul className="mt-1.5 list-inside list-disc space-y-0.5">
              <li>ExternalId, trust principal, RoleName={CONNECTOR_STACK_NAME}</li>
              <li>
                Advanced policy generation: {opts.enable_advanced_policy_generation ? "Yes" : "No"}
              </li>
              <li>Remediation modules match your current Vigil settings</li>
              <li>CAPABILITY_NAMED_IAM</li>
            </ul>
          </div>

          {artifactsQuery.isError && (
            <p className="text-sm text-red-600">Could not build update command for this version.</p>
          )}

          {artifactsQuery.data?.update_cli_command && (
            <pre className="max-h-40 overflow-auto rounded-lg border border-zinc-200 bg-zinc-900 p-3 text-[11px] leading-relaxed text-zinc-100">
              {artifactsQuery.data.update_cli_command}
            </pre>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-100 bg-zinc-50/50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={copyCli}
            disabled={!artifactsQuery.data?.update_cli_command}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            {copied ? "Copied" : "Copy CLI command"}
          </button>
          <a
            href={artifactsQuery.data?.console_stack_url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className={`rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 ${
              !artifactsQuery.data?.console_stack_url ? "pointer-events-none opacity-50" : ""
            }`}
            onClick={(e) => {
              if (!artifactsQuery.data?.console_stack_url) e.preventDefault();
            }}
          >
            Open stack in AWS
          </a>
        </div>
      </div>
    </div>
  );
}
