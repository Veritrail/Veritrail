import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, formatApiError } from "../api";
import ConfirmDialog from "./ConfirmDialog";
import { roleAtLeast, useMe } from "../hooks/useMe";

export type EvidenceComment = {
  id: string;
  artifact_id: string;
  body: string;
  author_user_id: string | null;
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
  const meQ = useMe();
  const qc = useQueryClient();
  const canDeleteAny = roleAtLeast(meQ.data?.role, "admin");

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<EvidenceComment | null>(null);

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

  const remove = useMutation({
    mutationFn: (commentId: string) =>
      api(`/v1/controls/evidence/${artifactId}/comments/${commentId}`, { method: "DELETE" }),
    onSuccess: () => {
      setPendingDelete(null);
      setError("");
      qc.invalidateQueries({ queryKey: ["evidence-comments", artifactId] });
    },
    onError: (err) => setError(formatApiError(err)),
  });

  const count = commentsQ.data?.length ?? 0;

  function canDeleteComment(comment: EvidenceComment) {
    if (canDeleteAny) return true;
    if (!meQ.data?.id) return false;
    return comment.author_user_id === meQ.data.id;
  }

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
              <div className="compliance-external-evidence__comment-head">
                <p className="compliance-external-evidence__comment-meta">
                  <span>{c.author_email ?? "User"}</span>
                  <span>{formatWhen(c.created_at)}</span>
                </p>
                {canDeleteComment(c) && (
                  <button
                    type="button"
                    className="compliance-external-evidence__comment-delete"
                    disabled={remove.isPending}
                    onClick={() => setPendingDelete(c)}
                  >
                    Delete
                  </button>
                )}
              </div>
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

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete comment?"
        description="This comment will be permanently removed from the evidence thread."
        confirmLabel="Delete comment"
        variant="danger"
        loading={remove.isPending}
        onCancel={() => !remove.isPending && setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.id);
        }}
      />
    </div>
  );
}
