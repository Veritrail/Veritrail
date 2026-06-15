import { useMutation, useQuery } from "@tanstack/react-query";
import { api, formatApiError } from "../api";

type JiraIssue = { issue_key: string; issue_url: string };

type Props = {
  findingId: string;
  existing?: { issue_key?: string; issue_url?: string } | null;
  onCreated?: (issue: JiraIssue) => void;
};

const BTN =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60";

export function JiraFindingAction({ findingId, existing, onCreated }: Props) {
  const { data: jira } = useQuery({
    queryKey: ["jira-integration"],
    queryFn: () => api<{ connected: boolean }>("/v1/integrations/jira"),
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: () =>
      api<JiraIssue>(`/v1/integrations/jira/issues/from-finding/${findingId}`, { method: "POST", body: "{}" }),
    onSuccess: (issue) => onCreated?.(issue),
  });

  if (!jira?.connected) return null;

  if (existing?.issue_key && existing.issue_url) {
    return (
      <a href={existing.issue_url} target="_blank" rel="noreferrer" className={BTN}>
        Jira {existing.issue_key}
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
      {create.isPending ? "Creating…" : "Create Jira ticket"}
    </button>
  );
}
