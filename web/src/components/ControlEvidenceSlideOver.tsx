import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, type ReactNode } from "react";
import { api, formatApiError } from "../api";
import ConfirmDialog from "./ConfirmDialog";
import { EvidenceArtifactComments } from "./EvidenceArtifactComments";
import { CriterionEvidenceUploadModal } from "./CriterionEvidenceUploadModal";
import { labelForCheck } from "../data/checkLabels";
import { roleAtLeast, useMe } from "../hooks/useMe";
import { downloadEvidenceArtifact } from "../lib/downloadEvidenceArtifact";
import { evidenceIsStale, type ExternalEvidenceArtifact } from "../lib/externalEvidence";
import type { ComplianceDisplayStatus } from "../lib/compositeRecommendedAction";
import { evidenceArtifactsForControl } from "../lib/controlEvidence";

type ControlSlice = {
  id: string;
  control_id: string;
  title: string;
  description?: string;
  check_ids: string[];
  status: "pass" | "fail" | "at_risk" | "no_data";
  finding_count: number;
};

type PendingAction =
  | { type: "delete"; artifact: ExternalEvidenceArtifact }
  | { type: "reject"; artifact: ExternalEvidenceArtifact }
  | null;

function statusLabel(status: string, stale: boolean) {
  if (stale && status === "accepted") return "Stale";
  if (status === "accepted") return "Accepted";
  if (status === "rejected") return "Rejected";
  if (status === "expired") return "Expired";
  if (status === "superseded") return "Superseded";
  return status;
}

function formatEvidenceDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Normalize legacy artifact note copy for display. */
function formatArtifactNote(note: string) {
  return note.replace(/\bCadence:/g, "Schedule:");
}

function reviewStatusCopy(item: ExternalEvidenceArtifact) {
  if (item.status === "submitted") {
    return "Awaiting review by an org admin";
  }
  if ((item.status === "accepted" || item.status === "rejected") && item.reviewed_by_email) {
    const when = formatEvidenceDate(item.reviewed_at);
    const verb = item.status === "accepted" ? "Accepted" : "Rejected";
    return when ? `${verb} by ${item.reviewed_by_email} on ${when}` : `${verb} by ${item.reviewed_by_email}`;
  }
  return null;
}

async function invalidateEvidenceQueries(qc: ReturnType<typeof useQueryClient>, framework?: string) {
  await qc.invalidateQueries({ queryKey: ["external-evidence"] });
  if (framework) {
    await qc.invalidateQueries({ queryKey: ["evidence-coverage", framework] });
  }
}

/** Bordered drawer card with optional uppercase label — matches History snapshot pills. */
export function ControlDetailPillCard({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`control-detail-pill${className ? ` ${className}` : ""}`}>
      {label ? <p className="control-detail-pill__label">{label}</p> : null}
      <div className="control-detail-pill__body">{children}</div>
    </div>
  );
}

/** Shared artifact list for control and composite detail drawers. */
export function ExternalEvidenceArtifactList({
  artifacts,
  emptyMessage = "No external evidence linked yet.",
  canComment = false,
  framework,
}: {
  artifacts: ExternalEvidenceArtifact[];
  emptyMessage?: string;
  canComment?: boolean;
  framework?: string;
}) {
  const meQ = useMe();
  const qc = useQueryClient();
  const canDelete = roleAtLeast(meQ.data?.role, "editor");
  const canReview = roleAtLeast(meQ.data?.role, "admin");

  const [downloadError, setDownloadError] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [actionError, setActionError] = useState("");

  const review = useMutation({
    mutationFn: ({
      artifactId,
      status,
      review_notes,
    }: {
      artifactId: string;
      status: "accepted" | "rejected";
      review_notes?: string;
    }) =>
      api<ExternalEvidenceArtifact>(`/v1/controls/evidence/${artifactId}/review`, {
        method: "PATCH",
        body: JSON.stringify({ status, review_notes }),
      }),
    onSuccess: async () => {
      setPendingAction(null);
      setRejectNotes("");
      setActionError("");
      await invalidateEvidenceQueries(qc, framework);
    },
    onError: (err) => setActionError(formatApiError(err)),
  });

  const remove = useMutation({
    mutationFn: (artifactId: string) =>
      api(`/v1/controls/evidence/${artifactId}`, { method: "DELETE" }),
    onSuccess: async () => {
      setPendingAction(null);
      setActionError("");
      await invalidateEvidenceQueries(qc, framework);
    },
    onError: (err) => setActionError(formatApiError(err)),
  });

  const actionPending = review.isPending || remove.isPending;

  if (artifacts.length === 0) {
    return <p className="control-evidence-drawer__empty">{emptyMessage}</p>;
  }

  return (
    <>
      <ul className="control-evidence-drawer__list">
        {artifacts.map((item) => {
          const stale = evidenceIsStale(item);
          const uploadedOn = formatEvidenceDate(item.created_at);
          const reviewCopy = reviewStatusCopy(item);
          return (
            <li key={item.id} className="control-evidence-drawer__item">
              <div className="control-evidence-drawer__item-head">
                <p className="control-evidence-drawer__item-title">{item.title}</p>
                {item.status !== "submitted" && (
                  <span
                    className={`compliance-external-evidence__status compliance-external-evidence__status--${
                      stale ? "stale" : item.status
                    }`}
                  >
                    {statusLabel(item.status, stale)}
                  </span>
                )}
              </div>
              <p className="control-evidence-drawer__item-meta">
                {uploadedOn && <span>Uploaded {uploadedOn}</span>}
                {item.source && <span>{item.source}</span>}
                {item.evidence_type && <span>{item.evidence_type}</span>}
                {item.check_id && <span>{labelForCheck(item.check_id)}</span>}
                {item.owner && <span>Owner: {item.owner}</span>}
                {item.period_end && <span>Through {item.period_end}</span>}
              </p>
              {reviewCopy && (
                <p className="control-evidence-drawer__item-review-note control-evidence-drawer__item-review-note--status">
                  {reviewCopy}
                </p>
              )}
              {item.note && (
                <p className="control-evidence-drawer__item-note">{formatArtifactNote(item.note)}</p>
              )}
              {item.review_notes && (
                <p className="control-evidence-drawer__item-review-note">{item.review_notes}</p>
              )}
              {item.superseded_by && (
                <p className="control-evidence-drawer__item-review-note">
                  Superseded by newer accepted evidence.
                </p>
              )}
              <div className="control-evidence-drawer__item-foot">
                <EvidenceArtifactComments artifactId={item.id} canComment={canComment} />
                <div className="control-evidence-drawer__item-actions">
                  {item.external_url ? (
                    <a
                      href={item.external_url}
                      target="_blank"
                      rel="noreferrer"
                      className="control-evidence-drawer__link"
                    >
                      Open link
                    </a>
                  ) : item.filename ? (
                    <button
                      type="button"
                      className="control-evidence-drawer__link"
                      onClick={() =>
                        downloadEvidenceArtifact(item).catch((err) =>
                          setDownloadError(err instanceof Error ? err.message : "Download failed"),
                        )
                      }
                    >
                      Download {item.filename}
                    </button>
                  ) : null}
                  {canReview && item.status === "submitted" && (
                    <>
                      <button
                        type="button"
                        className="control-evidence-drawer__link control-evidence-drawer__link--accept"
                        disabled={actionPending}
                        onClick={() => {
                          setActionError("");
                          review.mutate({ artifactId: item.id, status: "accepted" });
                        }}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="control-evidence-drawer__link control-evidence-drawer__link--reject"
                        disabled={actionPending}
                        onClick={() => {
                          setActionError("");
                          setRejectNotes("");
                          setPendingAction({ type: "reject", artifact: item });
                        }}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      className="control-evidence-drawer__link control-evidence-drawer__link--danger"
                      disabled={actionPending}
                      onClick={() => {
                        setActionError("");
                        setPendingAction({ type: "delete", artifact: item });
                      }}
                    >
                      Delete
                    </button>
                  )}
                  {item.checksum_sha256 && (
                    <span className="compliance-external-evidence__checksum" title={item.checksum_sha256}>
                      SHA-256 {item.checksum_sha256.slice(0, 8)}…
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {downloadError && <p className="compliance-external-evidence__error">{downloadError}</p>}
      {actionError && <p className="compliance-external-evidence__error">{actionError}</p>}

      <ConfirmDialog
        open={pendingAction?.type === "delete"}
        title="Delete external evidence?"
        description={
          pendingAction?.type === "delete"
            ? `"${pendingAction.artifact.title}" will be permanently removed from this workspace, including any uploaded file. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete evidence"
        variant="danger"
        loading={remove.isPending}
        onCancel={() => !remove.isPending && setPendingAction(null)}
        onConfirm={() => {
          if (pendingAction?.type === "delete") {
            remove.mutate(pendingAction.artifact.id);
          }
        }}
      />

      {pendingAction?.type === "reject" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-[2px]"
          onClick={() => !review.isPending && setPendingAction(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-evidence-title"
            className="w-full max-w-md rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-xl shadow-zinc-900/10"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="reject-evidence-title" className="text-base font-semibold tracking-tight text-zinc-950">
              Reject evidence?
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">
              &ldquo;{pendingAction.artifact.title}&rdquo; will not count toward coverage. The submitter can upload
              again.
            </p>
            <label className="mt-4 block text-sm font-medium text-zinc-700" htmlFor="reject-evidence-notes">
              Review note (optional)
            </label>
            <textarea
              id="reject-evidence-notes"
              className="compliance-external-evidence__textarea mt-1.5 w-full"
              rows={3}
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              placeholder="Reason for rejection or what to fix"
              maxLength={4000}
            />
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={review.isPending}
                onClick={() => setPendingAction(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={review.isPending}
                onClick={() =>
                  review.mutate({
                    artifactId: pendingAction.artifact.id,
                    status: "rejected",
                    review_notes: rejectNotes.trim() || undefined,
                  })
                }
              >
                {review.isPending ? "Rejecting…" : "Reject evidence"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Evidence tab content for a single control's master-detail panel.
 * Replaces the old full-page ControlEvidenceSlideOver overlay — same content,
 * minus the portal/backdrop/header chrome the panel shell now provides.
 */
export function ControlEvidenceTabContent({
  control,
  artifacts,
  findingCountByCheck,
  displayStatus,
  submittedCount = 0,
  framework,
  compositeId,
  canEdit = false,
}: {
  control: ControlSlice;
  artifacts: ExternalEvidenceArtifact[];
  findingCountByCheck: Map<string, number>;
  displayStatus: ComplianceDisplayStatus;
  submittedCount?: number;
  framework: string;
  compositeId?: string | null;
  canEdit?: boolean;
}) {
  const [uploadOpen, setUploadOpen] = useState(false);

  const linked = useMemo(
    () => evidenceArtifactsForControl(artifacts, control),
    [artifacts, control],
  );

  return (
    <div className="control-evidence-tab">
      <section className="control-evidence-slideover__section">
        <div className="control-evidence-slideover__section-head">
          <h3 className="control-evidence-slideover__section-title">External evidence</h3>
          {canEdit ? (
            <button
              type="button"
              className="control-evidence-drawer__link control-evidence-drawer__link--head"
              onClick={() => setUploadOpen(true)}
            >
              Add external evidence
            </button>
          ) : null}
        </div>
        <ControlDetailPillCard>
          {linked.length === 0 ? (
            <p className="control-evidence-drawer__empty">No external evidence linked to this criterion yet.</p>
          ) : (
            <ExternalEvidenceArtifactList artifacts={linked} canComment={canEdit} framework={framework} />
          )}
        </ControlDetailPillCard>
      </section>

      <CriterionEvidenceUploadModal
        open={uploadOpen}
        framework={framework}
        controlId={control.id}
        controlRef={control.control_id}
        compositeId={compositeId}
        checkIds={control.check_ids}
        onClose={() => setUploadOpen(false)}
      />
    </div>
  );
}
