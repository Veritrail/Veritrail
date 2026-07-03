import { useMutation, useQuery } from "@tanstack/react-query";
import { api, formatApiError } from "../api";
import { githubIssuesIntegrationSchema } from "../lib/apiSchemas";

type GitHubIssue = { issue_key: string; issue_url: string };

type Props = {
  findingId: string;
  existing?: { issue_key?: string; issue_url?: string } | null;
  onCreated?: (issue: GitHubIssue) => void;
};

const BTN =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60";

export function GitHubIssuesFindingAction({ findingId, existing, onCreated }: Props) {
  const { data: githubIssues } = useQuery({
    queryKey: ["github-issues-integration"],
    queryFn: () => api("/v1/integrations/github-issues", { schema: githubIssuesIntegrationSchema }),
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: () =>
      api<GitHubIssue>(`/v1/integrations/github-issues/from-finding/${findingId}`, { method: "POST", body: "{}" }),
    onSuccess: (issue) => onCreated?.(issue),
  });

  if (!githubIssues?.connected) return null;

  if (existing?.issue_key && existing.issue_url) {
    return (
      <a href={existing.issue_url} target="_blank" rel="noreferrer" className={BTN}>
        GitHub #{existing.issue_key}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={BTN}
      disabled={create.isPending}
      onClick={() => create.mutate()}
      title={create.error ? formatApiError(create.error) : undefined}
    >
      {create.isPending ? "Creating…" : "Create GitHub issue"}
    </button>
  );
}
