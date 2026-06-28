import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AbsenceGapCallout } from "./AbsenceGapCallout";
import { EvidenceArtifactComments } from "./EvidenceArtifactComments";
import { CriterionEvidenceUploadModal } from "./CriterionEvidenceUploadModal";
import { labelForCheck } from "../data/checkLabels";
import {
  drawerBody,
  drawerBodyText,
  drawerEyebrow,
  drawerTitle,
} from "./drawerStyles";
import { downloadEvidenceArtifact } from "../lib/downloadEvidenceArtifact";
import { evidenceIsStale, type ExternalEvidenceArtifact } from "../lib/externalEvidence";
import { findingsHrefForAbsenceGaps, openAbsenceGapChecks } from "../lib/evidenceGap";
import {
  compositeRecommendedAction,
  type ComplianceDisplayStatus,
} from "../lib/compositeRecommendedAction";
import { evidenceArtifactsForControl } from "../lib/controlEvidence";
import { useAppScrollLock } from "../lib/useAppScrollLock";

type ControlSlice = {
  id: string;
  control_id: string;
  title: string;
  description?: string;
  check_ids: string[];
  status: "pass" | "fail" | "at_risk" | "no_data";
  finding_count: number;
};

function statusLabel(status: string, stale: boolean) {
  if (stale && status === "accepted") return "Stale";
  if (status === "accepted") return "Accepted";
  if (status === "rejected") return "Rejected";
  if (status === "submitted") return "Pending review";
  if (status === "expired") return "Expired";
  if (status === "superseded") return "Superseded";
  return status;
}

function topFailingChecks(checkIds: string[], findingCountByCheck: Map<string, number>, max = 8) {
  return [...checkIds]
    .filter((id) => (findingCountByCheck.get(id) ?? 0) > 0)
    .sort((a, b) => (findingCountByCheck.get(b) ?? 0) - (findingCountByCheck.get(a) ?? 0))
    .slice(0, max);
}

export function ControlEvidenceSlideOver({
  open,
  control,
  artifacts,
  findingCountByCheck,
  displayStatus,
  submittedCount = 0,
  framework,
  compositeId,
  canEdit = false,
  onClose,
}: {
  open: boolean;
  control: ControlSlice | null;
  artifacts: ExternalEvidenceArtifact[];
  findingCountByCheck: Map<string, number>;
  displayStatus: ComplianceDisplayStatus;
  submittedCount?: number;
  framework: string;
  compositeId?: string | null;
  canEdit?: boolean;
  onClose: () => void;
}) {
  const [downloadError, setDownloadError] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  useAppScrollLock(open);

  useEffect(() => {
    if (!open) return;
    setDownloadError("");
    setUploadOpen(false);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const linked = useMemo(
    () => (control ? evidenceArtifactsForControl(artifacts, control) : []),
    [artifacts, control],
  );
  const openGaps = control ? openAbsenceGapChecks(control.check_ids, findingCountByCheck) : [];
  const recommended = compositeRecommendedAction(displayStatus, { submittedCount });
  const remediateHref = control
    ? findingsHrefForAbsenceGaps(control.check_ids, findingCountByCheck)
    : null;
  const findingsHref =
    control && control.finding_count > 0
      ? `/findings?checks=${encodeURIComponent(
          control.check_ids.filter((id) => (findingCountByCheck.get(id) ?? 0) > 0).join(","),
        )}`
      : null;
  const failingChecks = control ? topFailingChecks(control.check_ids, findingCountByCheck) : [];

  if (!open || !control) return null;

  return createPortal(
    <>
      <div
        className="control-evidence-slideover__backdrop"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="control-evidence-slideover finding-drawer-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="control-evidence-slideover-title"
      >
        <header className="control-evidence-slideover__header">
          <button type="button" className="control-evidence-slideover__close" onClick={onClose} aria-label="Close">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <p className={drawerEyebrow}>Criterion evidence</p>
          <h2 id="control-evidence-slideover-title" className={drawerTitle}>
            <span className="font-mono text-zinc-500">{control.control_id}</span> {control.title}
          </h2>
          {control.description ? (
            <p className={`mt-1.5 ${drawerBodyText}`}>{control.description}</p>
          ) : null}
        </header>

        <div className={`${drawerBody} control-evidence-slideover__body`}>
          {recommended && (
            <div className={`control-evidence-drawer__action control-evidence-drawer__action--${recommended.tone}`}>
              <p className="control-evidence-drawer__action-title">{recommended.title}</p>
              <p className="control-evidence-drawer__action-detail">{recommended.detail}</p>
            </div>
          )}

          {openGaps.length > 0 && (
            <AbsenceGapCallout
              checkIds={control.check_ids}
              findingCountByCheck={findingCountByCheck}
              remediateHref={remediateHref}
              compact
            />
          )}

          <section className="control-evidence-slideover__section">
            <div className="control-evidence-slideover__section-head">
              <h3 className="control-evidence-slideover__section-title">External evidence</h3>
              {canEdit ? (
                <button
                  type="button"
                  className="compliance-external-evidence__link"
                  onClick={() => setUploadOpen(true)}
                >
                  Add external evidence
                </button>
              ) : null}
            </div>
            {linked.length === 0 ? (
              <p className="control-evidence-drawer__empty">No external evidence linked to this criterion yet.</p>
            ) : (
              <ul className="control-evidence-drawer__list">
                {linked.map((item) => {
                  const stale = evidenceIsStale(item);
                  return (
                    <li key={item.id} className="control-evidence-drawer__item">
                      <div className="min-w-0 flex-1">
                        <p className="control-evidence-drawer__item-title">{item.title}</p>
                        <p className="control-evidence-drawer__item-meta">
                          {item.source && <span>{item.source}</span>}
                          {item.evidence_type && <span>{item.evidence_type}</span>}
                          {item.check_id && <span>{labelForCheck(item.check_id)}</span>}
                          {item.owner && <span>Owner: {item.owner}</span>}
                          {item.period_end && <span>Through {item.period_end}</span>}
                        </p>
                        {item.note && <p className="control-evidence-slideover__note">{item.note}</p>}
                        {item.review_notes && (
                          <p className="control-evidence-slideover__review-note">{item.review_notes}</p>
                        )}
                        {item.superseded_by && (
                          <p className="control-evidence-slideover__review-note">Superseded by newer accepted evidence.</p>
                        )}
                        <EvidenceArtifactComments artifactId={item.id} canComment={canEdit} />
                        <div className="control-evidence-slideover__item-actions">
                          {item.external_url ? (
                            <a
                              href={item.external_url}
                              target="_blank"
                              rel="noreferrer"
                              className="compliance-external-evidence__link"
                            >
                              Open link
                            </a>
                          ) : item.filename ? (
                            <button
                              type="button"
                              className="compliance-external-evidence__link"
                              onClick={() =>
                                downloadEvidenceArtifact(item).catch((err) =>
                                  setDownloadError(err instanceof Error ? err.message : "Download failed"),
                                )
                              }
                            >
                              Download {item.filename}
                            </button>
                          ) : null}
                          {item.checksum_sha256 && (
                            <span className="compliance-external-evidence__checksum" title={item.checksum_sha256}>
                              SHA-256 {item.checksum_sha256.slice(0, 8)}…
                            </span>
                          )}
                        </div>
                      </div>
                      <span
                        className={`compliance-external-evidence__status compliance-external-evidence__status--${
                          stale ? "stale" : item.status
                        }`}
                      >
                        {statusLabel(item.status, stale)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {control.check_ids.length > 0 && (
            <section className="control-evidence-slideover__section">
              <h3 className="control-evidence-slideover__section-title">
                Automated checks ({control.check_ids.length})
              </h3>
              <ul className="control-evidence-slideover__checks">
                {control.check_ids.map((id) => {
                  const count = findingCountByCheck.get(id) ?? 0;
                  return (
                    <li key={id} className="control-evidence-slideover__check">
                      <span className="control-evidence-slideover__check-label">{labelForCheck(id)}</span>
                      <span
                        className={
                          count > 0
                            ? "control-evidence-slideover__check-count control-evidence-slideover__check-count--open"
                            : "control-evidence-slideover__check-count"
                        }
                      >
                        {count > 0 ? `${count} open` : "Clear"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {failingChecks.length > 0 && (
            <section className="control-evidence-slideover__section">
              <h3 className="control-evidence-slideover__section-title">Top failing checks</h3>
              <ul className="control-evidence-slideover__checks">
                {failingChecks.map((id) => (
                  <li key={id} className="control-evidence-slideover__check">
                    <span className="control-evidence-slideover__check-label">{labelForCheck(id)}</span>
                    <span className="control-evidence-slideover__check-count control-evidence-slideover__check-count--open">
                      {findingCountByCheck.get(id)} open
                    </span>
                  </li>
                ))}
              </ul>
              {findingsHref && (
                <Link to={findingsHref} className="control-evidence-drawer__findings-link">
                  View all {control.finding_count} findings →
                </Link>
              )}
            </section>
          )}

          {downloadError && <p className="compliance-external-evidence__error">{downloadError}</p>}
        </div>
      </div>
      {control && (
        <CriterionEvidenceUploadModal
          open={uploadOpen}
          framework={framework}
          controlId={control.id}
          controlRef={control.control_id}
          compositeId={compositeId}
          checkIds={control.check_ids}
          onClose={() => setUploadOpen(false)}
        />
      )}
    </>,
    document.body,
  );
}
