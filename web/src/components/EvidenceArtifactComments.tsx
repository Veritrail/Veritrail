import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, formatApiError } from "../api";

export type EvidenceComment = {
  id: string;
  artifact_id: string;
  body: string;
  author_email: string | null;
  created_at: string;
};

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function EvidenceArtifactComments({
  artifactId,
  canComment,
}: {
  artifactId: string;
  canComment: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const commentsQ = useQuery({
    queryKey: ["evidence-comments", artifactId],
    queryFn: () => api<EvidenceComment[]>(`/v1/controls/evidence/${artifactId}/comments`),
    enabled: open,
  });

  const post = useMutation({
    mutationFn: (body: string) =>
      api<EvidenceComment>(`/v1/controls/evidence/${artifactId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      setDraft("");
      setError("");
      qc.invalidateQueries({ queryKey: ["evidence-comments", artifactId] });
    },
    onError: (err) => setError(formatApiError(err)),
  });

  const count = commentsQ.data?.length ?? 0;

  return (
    <div className="compliance-external-evidence__comments">
      <button
        type="button"
        className="compliance-external-evidence__comments-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide" : "Show"} comments{count > 0 ? ` (${count})` : ""}
      </button>
      {open && (
        <div className="compliance-external-evidence__comments-panel">
          {commentsQ.isLoading && <p className="compliance-external-evidence__empty">Loading comments…</p>}
          {commentsQ.isError && (
            <p className="compliance-external-evidence__error">{formatApiError(commentsQ.error)}</p>
          )}
          {commentsQ.data && commentsQ.data.length === 0 && (
            <p className="compliance-external-evidence__empty">No comments yet.</p>
          )}
          {commentsQ.data?.map((c) => (
            <div key={c.id} className="compliance-external-evidence__comment">
              <p className="compliance-external-evidence__comment-meta">
                <span>{c.author_email ?? "User"}</span>
                <span>{formatWhen(c.created_at)}</span>
              </p>
              <p className="compliance-external-evidence__comment-body">{c.body}</p>
            </div>
          ))}
          {canComment && (
            <form
              className="compliance-external-evidence__comment-form"
              onSubmit={(e) => {
                e.preventDefault();
                const body = draft.trim();
                if (!body) return;
                post.mutate(body);
              }}
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                placeholder="Ask a question or note context for reviewers…"
                maxLength={4000}
              />
              {error && <p className="compliance-external-evidence__error">{error}</p>}
              <button type="submit" disabled={post.isPending || !draft.trim()}>
                {post.isPending ? "Posting…" : "Add comment"}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
