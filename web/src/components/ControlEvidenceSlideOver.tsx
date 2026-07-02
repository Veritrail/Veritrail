import { useState, useMemo } from "react";
import { AbsenceGapCallout } from "./AbsenceGapCallout";
import { EvidenceArtifactComments } from "./EvidenceArtifactComments";
import { CriterionEvidenceUploadModal } from "./CriterionEvidenceUploadModal";
import { labelForCheck } from "../data/checkLabels";
import { downloadEvidenceArtifact } from "../lib/downloadEvidenceArtifact";
import { evidenceIsStale, type ExternalEvidenceArtifact } from "../lib/externalEvidence";
import { findingsHrefForAbsenceGaps, openAbsenceGapChecks } from "../lib/evidenceGap";
import {
  compositeRecommendedAction,
  type ComplianceDisplayStatus,
} from "../lib/compositeRecommendedAction";
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

function statusLabel(status: string, stale: boolean) {
  if (stale && status === "accepted") return "Stale";
  if (status === "accepted") return "Accepted";
  if (status === "rejected") return "Rejected";
  if (status === "submitted") return "Pending review";
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

/** Shared artifact list for control and composite detail drawers. */
export function ExternalEvidenceArtifactList({
  artifacts,
  emptyMessage = "No external evidence linked yet.",
  canComment = false,
}: {
  artifacts: ExternalEvidenceArtifact[];
  emptyMessage?: string;
  canComment?: boolean;
}) {
  const [downloadError, setDownloadError] = useState("");

  if (artifacts.length === 0) {
    return <p className="control-evidence-drawer__empty">{emptyMessage}</p>;
  }

  return (
    <>
      <ul className="control-evidence-drawer__list">
        {artifacts.map((item) => {
          const stale = evidenceIsStale(item);
          const uploadedOn = formatEvidenceDate(item.created_at);
          return (
            <li key={item.id} className="control-evidence-drawer__item">
              <div className="control-evidence-drawer__item-head">
                <p className="control-evidence-drawer__item-title">{item.title}</p>
                <span
                  className={`compliance-external-evidence__status compliance-external-evidence__status--${
                    stale ? "stale" : item.status
                  }`}
                >
                  {statusLabel(item.status, stale)}
                </span>
              </div>
              <p className="control-evidence-drawer__item-meta">
                {uploadedOn && <span>Uploaded {uploadedOn}</span>}
                {item.source && <span>{item.source}</span>}
                {item.evidence_type && <span>{item.evidence_type}</span>}
                {item.check_id && <span>{labelForCheck(item.check_id)}</span>}
                {item.owner && <span>Owner: {item.owner}</span>}
                {item.period_end && <span>Through {item.period_end}</span>}
              </p>
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
  const openGaps = openAbsenceGapChecks(control.check_ids, findingCountByCheck);
  const recommended = compositeRecommendedAction(displayStatus, { submittedCount });
  const remediateHref = findingsHrefForAbsenceGaps(control.check_ids, findingCountByCheck);

  return (
    <div className="control-evidence-tab">
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
              className="control-evidence-drawer__link control-evidence-drawer__link--head"
              onClick={() => setUploadOpen(true)}
            >
              Add external evidence
            </button>
          ) : null}
        </div>
        {linked.length === 0 ? (
          <p className="control-evidence-drawer__empty">No external evidence linked to this criterion yet.</p>
        ) : (
          <ExternalEvidenceArtifactList artifacts={linked} canComment={canEdit} />
        )}
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
