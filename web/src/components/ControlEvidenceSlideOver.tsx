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
  const [downloadError, setDownloadError] = useState("");
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

      {downloadError && <p className="compliance-external-evidence__error">{downloadError}</p>}

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
