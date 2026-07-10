import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { parseCfnLaunchMeta } from "../lib/cfnDeployCommands";
import { CONNECTOR_STACK_NAME } from "../lib/connectionPosture";
import { type RemediationModules } from "../data/remediationModules";
import { RotateExternalIdModal } from "./RotateExternalIdModal";

type ConnectorUpdateAccount = {
  id: string;
  cfn_stack_name: string;
  cfn_template_version: string | null;
  cfn_launch_url: string;
  external_id: string;
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

type WhatChangedRow = {
  label: string;
  detail: string;
};

function formatConnectorVersion(tag: string | null | undefined): string {
  if (!tag?.trim()) return "Not recorded";
  const t = tag.trim();
  return t.startsWith("v") ? t : `v${t}`;
}

function normalizeVersionTag(tag: string | null | undefined): string | null {
  if (!tag?.trim()) return null;
  return tag.trim().replace(/^v/i, "");
}

function truncateToken(value: string, head = 20, tail = 8): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function buildWhatChangedRows(
  acc: ConnectorUpdateAccount,
  selectedTag: string,
  opts: {
    enable_advanced_policy_generation: boolean;
    remediation_modules: RemediationModules;
  },
): WhatChangedRow[] {
  const deployed = normalizeVersionTag(acc.cfn_template_version);
  const selected = normalizeVersionTag(selectedTag);
  const sameVersion = deployed != null && selected != null && deployed === selected;
  const rows: WhatChangedRow[] = [];

  if (sameVersion) {
    rows.push({
      label: "Configuration sync",
      detail:
        "Same connector version — updated configuration required to sync IAM permissions with your Veritrail settings.",
    });
  } else if (deployed && selected && deployed !== selected) {
    rows.push({
      label: "Connector template",
      detail: `Updates from ${formatConnectorVersion(deployed)} to ${formatConnectorVersion(selected)}.`,
    });
  } else {
    rows.push({
      label: "Connector template",
      detail: `Applies ${formatConnectorVersion(selectedTag)} CloudFormation template to your stack.`,
    });
  }

  rows.push({
    label: "Advanced policy generation",
    detail: opts.enable_advanced_policy_generation
      ? "Enabled for this connector version."
      : "Not enabled for this account in this update.",
  });

  rows.push({
    label: "Template URL",
    detail: `Updated to the ${formatConnectorVersion(selectedTag)} template release.`,
  });

  rows.push({
    label: "CloudFormation capability",
    detail: "Uses CAPABILITY_NAMED_IAM because the stack updates IAM resources.",
  });

  return rows;
}

function CheckIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

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

  const recommended = versionsQuery.data?.recommended_version_tag ?? "2026.06";
  const [selectedTag, setSelectedTag] = useState(recommended);
  const [cmdExpanded, setCmdExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedTag(versionsQuery.data?.recommended_version_tag ?? "2026.06");
    setCmdExpanded(false);
    setCopied(false);
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

  const deployedVersionTag = acc.cfn_template_version?.trim() || null;
  const currentDisplay = formatConnectorVersion(deployedVersionTag);
  const targetDisplay = formatConnectorVersion(selectedTag);
  const sameVersion =
    normalizeVersionTag(deployedVersionTag) != null &&
    normalizeVersionTag(selectedTag) != null &&
    normalizeVersionTag(deployedVersionTag) === normalizeVersionTag(selectedTag);

  const whatChanged = useMemo(
    () => buildWhatChangedRows(acc, selectedTag, opts),
    [acc, selectedTag, acc.enable_advanced_policy_generation, acc.remediation_modules],
  );

  const launchMeta = useMemo(() => parseCfnLaunchMeta(acc.cfn_launch_url), [acc.cfn_launch_url]);
  const trustPrincipal = launchMeta.trustPrincipalArn;
  const roleName = launchMeta.scannerRoleName || CONNECTOR_STACK_NAME;

  async function copyCli() {
    const cmd = artifactsQuery.data?.update_cli_command;
    if (!cmd) return;
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!open) return null;

  return (
    <>
    <div
      className="fixed inset-0 z-[250] flex items-end justify-center bg-zinc-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connector-update-title"
    >
      <div className="flex max-h-[min(90vh,44rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/15">
        <div className="border-b border-zinc-100 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <h2 id="connector-update-title" className="text-base font-semibold text-zinc-900">
              Update connector
            </h2>
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

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Current version</p>
              <p className="mt-1 font-mono text-sm font-semibold text-zinc-900">{currentDisplay}</p>
              {sameVersion && (
                <p className="mt-1 text-[11px] leading-snug text-amber-800/90">
                  Same as target — configuration sync required
                </p>
              )}
            </div>
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">Target version</p>
              <p className="mt-1 font-mono text-sm font-semibold text-indigo-950">{targetDisplay}</p>
              <p className="mt-0.5 text-[11px] text-indigo-900/70">
                {selectedVersion?.label ?? "Approved connector release"}
              </p>
            </div>
          </div>

          {versions.length > 1 && (
            <div>
              <p className="text-xs font-semibold text-zinc-700">Version to apply</p>
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
                    className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 transition ${
                      selectedTag === v.tag
                        ? "border-indigo-300 bg-indigo-50/50 ring-1 ring-indigo-200/80"
                        : "border-zinc-200 hover:border-zinc-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="connector-version"
                      className="mt-0.5"
                      checked={selectedTag === v.tag}
                      onChange={() => setSelectedTag(v.tag)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-mono text-sm font-semibold text-zinc-900">
                        {formatConnectorVersion(v.tag)}
                      </span>
                      {v.status === "recommended" && (
                        <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-800">
                          Recommended
                        </span>
                      )}
                      <p className="mt-0.5 text-xs leading-relaxed text-zinc-600">{v.notes}</p>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-zinc-800">What changed in this update</p>
            <ul className="mt-2.5 space-y-2.5">
              {whatChanged.map((row) => (
                <li key={row.label} className="flex gap-2.5">
                  <CheckIcon />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-zinc-800">{row.label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-zinc-600">{row.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-zinc-100 bg-zinc-50/40 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Unchanged</p>
            <dl className="mt-2 space-y-2 text-xs">
              <div>
                <dt className="font-medium text-zinc-500">External ID</dt>
                <dd className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-zinc-600" title={acc.external_id}>
                  <span>{truncateToken(acc.external_id)}</span>
                  <button
                    type="button"
                    onClick={() => setRotateOpen(true)}
                    className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50"
                  >
                    Rotate
                  </button>
                </dd>
              </div>
              <div>
                <dt className="font-medium text-zinc-500">Trusted principal</dt>
                <dd className="mt-0.5 break-all font-mono text-zinc-600" title={trustPrincipal || undefined}>
                  {trustPrincipal ? truncateToken(trustPrincipal, 28, 12) : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-zinc-500">Connector role name</dt>
                <dd className="mt-0.5 font-mono text-zinc-600">{roleName}</dd>
              </div>
            </dl>
          </div>

          {artifactsQuery.isError && (
            <p className="text-sm text-red-600">Could not build update command for this version.</p>
          )}

          {artifactsQuery.data?.update_cli_command && (
            <div className="overflow-hidden rounded-lg border border-zinc-200">
              <div className="flex items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50/80 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setCmdExpanded((v) => !v)}
                  className="min-w-0 flex-1 text-left text-xs font-semibold text-zinc-800"
                  aria-expanded={cmdExpanded}
                >
                  Generated update command
                  <span className="ml-1.5 font-normal text-zinc-500">
                    {cmdExpanded ? "Hide" : "Show"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={copyCli}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50"
                  title={copied ? "Copied" : "Copy command"}
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2m-6 12h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z"
                    />
                  </svg>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              {cmdExpanded && (
                <pre className="max-h-[140px] overflow-auto bg-zinc-900 p-3 text-[11px] leading-relaxed text-zinc-100">
                  {artifactsQuery.data.update_cli_command}
                </pre>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-100 bg-zinc-50/50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={copyCli}
            disabled={!artifactsQuery.data?.update_cli_command}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            {copied ? "Copied" : "Copy command"}
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
            Open CloudFormation
          </a>
        </div>
      </div>
    </div>
    <RotateExternalIdModal
      open={rotateOpen}
      onClose={() => setRotateOpen(false)}
      accountId={acc.id}
    />
    </>
  );
}
