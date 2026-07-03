import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, formatApiError } from "../api";
import { iacRepositoryIntegrationSchema } from "../lib/apiSchemas";
import { IaCRemediationSection } from "./IaCRemediationSection";

type RemediationTicket = { issue_key: string; issue_url: string };

type Props = {
  findingId: string;
  checkId: string;
  resourceArn?: string | null;
  existing?: { issue_key?: string; issue_url?: string } | null;
  onCreated?: (ticket: RemediationTicket) => void;
};

const BTN =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60";

const VCS_LABELS: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  azure_devops: "Azure DevOps",
  codecommit: "AWS CodeCommit",
};

function pathHint(resourceArn?: string | null): string {
  if (!resourceArn) {
    return "Match the linked paths to the stack that owns this resource — Terragrunt live dirs often map to account, region, or environment.";
  }
  const regionMatch = resourceArn.match(/:([a-z]{2}-[a-z]+-\d):/);
  if (regionMatch) {
    return `Resource is in ${regionMatch[1]} — look for a Terragrunt path or live-stack repo under that region or environment.`;
  }
  return "Match the linked paths to the stack that owns this resource.";
}

function ConnectSteps() {
  return (
    <ol className="mt-3 list-decimal space-y-2 pl-4 text-[12px] leading-relaxed text-amber-950/90">
      <li>
        Open <Link to="/integrations/iac-repository" className="font-semibold underline">Integrations → IaC repository</Link>
      </li>
      <li>Choose your VCS provider (GitHub, GitLab, Azure DevOps, or CodeCommit)</li>
      <li>Tell us whether you use Terragrunt and if modules and live stacks share one repo or two</li>
      <li>Link the repository paths — then return here for Terraform snippets and remediation tickets</li>
    </ol>
  );
}

export function TerraformIacDrawerSection({
  findingId,
  checkId,
  resourceArn,
  existing,
  onCreated,
}: Props) {
  const { data: iacRepo, isLoading } = useQuery({
    queryKey: ["iac-repository-integration"],
    queryFn: () => api("/v1/integrations/iac-repository", { schema: iacRepositoryIntegrationSchema }),
    staleTime: 60_000,
  });

  const createTicket = useMutation({
    mutationFn: () =>
      api<RemediationTicket>(`/v1/integrations/iac-repository/from-finding/${findingId}`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: (ticket) => onCreated?.(ticket),
  });

  if (isLoading) {
    return <p className="text-[13px] text-zinc-500">Loading IaC repository…</p>;
  }

  const dual = iacRepo?.repo_mode === "dual";
  const usesTerragrunt = !!iacRepo?.uses_terragrunt;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/50 px-4 py-3">
        <p className="text-[13px] font-semibold text-indigo-950">Terraform / IaC</p>
        <p className="mt-1 text-[12px] leading-relaxed text-indigo-900/90">
          For teams where cloud fixes land as Terraform or Terragrunt pull requests. Link your IaC repository once —
          Veritrail shows which paths to edit and can open a tracked remediation ticket for this finding.
        </p>
      </div>

      {!iacRepo?.connected ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-[12px] leading-relaxed text-amber-950">
          <p className="font-semibold">IaC repository not connected</p>
          <p className="mt-1">
            Connect the repo where your team implements cloud fixes before using Terraform remediation from findings.
          </p>
          <ConnectSteps />
          <Link
            to="/integrations/iac-repository"
            className="mt-3 inline-flex rounded-lg bg-amber-900 px-3 py-2 text-[12px] font-semibold text-white hover:bg-amber-950"
          >
            Link IaC repository
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 px-4 py-3 text-[12px] text-zinc-800">
          <p className="font-semibold text-zinc-900">Linked layout</p>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Provider</dt>
              <dd>{VCS_LABELS[iacRepo.vcs_provider ?? "github"] ?? iacRepo.vcs_provider}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Terragrunt</dt>
              <dd>{usesTerragrunt ? "Yes" : "No"}</dd>
            </div>
            {usesTerragrunt && (
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Layout</dt>
                <dd>{dual ? "Two repositories" : "One repo, different paths"}</dd>
              </div>
            )}
          </dl>

          <div className="mt-3 rounded-lg border border-zinc-200/80 bg-white px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Terraform modules</p>
            <p className="font-mono text-[11px] text-zinc-800">
              {iacRepo.terraform_repo?.repo_ref ?? iacRepo.repo_ref} @ {iacRepo.terraform_path}
            </p>
          </div>

          {usesTerragrunt && (
            <div className="mt-2 rounded-lg border border-zinc-200/80 bg-white px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Terragrunt live stacks</p>
              <p className="font-mono text-[11px] text-zinc-800">
                {dual
                  ? `${iacRepo.terragrunt_repo?.repo_ref ?? "—"} @ ${iacRepo.terragrunt_repo?.path ?? "."}`
                  : iacRepo.paths_differ
                    ? `${iacRepo.terraform_repo?.repo_ref ?? iacRepo.repo_ref} @ ${iacRepo.terragrunt_path}`
                    : `${iacRepo.terraform_repo?.repo_ref ?? iacRepo.repo_ref} (same path)`}
              </p>
            </div>
          )}

          {iacRepo.pr_path && (
            <div className="mt-2 rounded-lg border border-indigo-200/60 bg-indigo-50/40 px-3 py-2">
              <p className="text-[11px] font-semibold text-indigo-900">Suggested PR target</p>
              <p className="font-mono text-[11px] text-indigo-950">
                {dual ? iacRepo.terragrunt_repo?.repo_ref : iacRepo.terraform_repo?.repo_ref} @ {iacRepo.pr_path}
              </p>
            </div>
          )}

          <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">{pathHint(resourceArn)}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-600">
            Copy the Terraform snippet below into the module path, then open a PR against the suggested target
            {dual ? " Terragrunt repository" : usesTerragrunt && iacRepo.paths_differ ? " Terragrunt directory" : ""}.
          </p>

          <div className="mt-3 border-t border-zinc-200/80 pt-3">
            {existing?.issue_key && existing.issue_url ? (
              <a href={existing.issue_url} target="_blank" rel="noreferrer" className={BTN}>
                Remediation ticket #{existing.issue_key}
              </a>
            ) : iacRepo.remediation_available ? (
              <button
                type="button"
                className={BTN}
                disabled={createTicket.isPending}
                onClick={() => createTicket.mutate()}
                title={createTicket.error ? formatApiError(createTicket.error) : undefined}
              >
                {createTicket.isPending ? "Creating…" : "Create remediation ticket"}
              </button>
            ) : (
              <p className="text-[11px] text-zinc-600">
                {iacRepo.remediation_unavailable_reason ?? "Remediation tickets are not available for this provider yet."}
              </p>
            )}
            {createTicket.error && (
              <p className="mt-2 text-[11px] text-red-700">{formatApiError(createTicket.error)}</p>
            )}
          </div>
        </div>
      )}

      <IaCRemediationSection embedMode="terraform" findingId={findingId} checkId={checkId} />
    </div>
  );
}
