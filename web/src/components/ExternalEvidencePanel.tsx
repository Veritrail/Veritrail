import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiUpload, formatApiError } from "../api";
import ConfirmDialog from "./ConfirmDialog";
import { Select, type SelectOption } from "./Select";
import { AbsenceGapCallout } from "./AbsenceGapCallout";
import { EvidenceArtifactComments } from "./EvidenceArtifactComments";
import { labelForCheck } from "../data/checkLabels";
import { roleAtLeast, useMe } from "../hooks/useMe";
import {
  evidenceIsStale,
  EXTERNAL_EVIDENCE_TYPES,
  type ExternalEvidenceArtifact,
} from "../lib/externalEvidence";
import {
  compositeNeedsExternalEvidence,
  findingsHrefForAbsenceGaps,
  openAbsenceGapChecks,
} from "../lib/evidenceGap";
import { cadenceOptionsForIntake, intakeConfigForComposite } from "../lib/evidenceCategoryIntake";
import {
  buildExternalCoverageNote,
  buildExternalWizardTitle,
  buildVulnWizardNote,
  buildVulnWizardTitle,
  registryKeyForComposite,
} from "../lib/evidenceSourceRegistry";
import { settingsSchema } from "../lib/apiSchemas";
import { downloadEvidenceArtifact } from "../lib/downloadEvidenceArtifact";

type UnderlyingCriterion = {
  id: string;
  control_id: string;
  title: string;
  finding_count: number;
};

function formatEvidenceDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function evidenceKindLabel(item: ExternalEvidenceArtifact) {
  if (item.external_url) return "Link";
  if (item.filename) return item.filename;
  return "Evidence";
}

function statusLabel(status: string, stale: boolean) {
  if (stale && status === "accepted") return "Stale";
  if (status === "accepted") return "Accepted";
  if (status === "rejected") return "Rejected";
  if (status === "submitted") return "Pending review";
  if (status === "expired") return "Expired";
  if (status === "superseded") return "Superseded";
  return status;
}

export function ExternalEvidencePanel({
  compositeId,
  compositeTitle,
  framework,
  groupStatus,
  checkIds,
  findingCountByCheck,
  underlyingCriteria,
  frameworkControlLabel,
}: {
  compositeId: string;
  compositeTitle: string;
  framework: string;
  groupStatus: "pass" | "fail" | "no_data";
  checkIds: string[];
  findingCountByCheck: Map<string, number>;
  underlyingCriteria: UnderlyingCriterion[];
  frameworkControlLabel: (controlId: string) => string;
}) {
  const meQ = useMe();
  const canEdit = roleAtLeast(meQ.data?.role, "editor");
  const canReview = roleAtLeast(meQ.data?.role, "admin");
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<"wizard" | "form">("form");
  const [source, setSource] = useState("");
  const [customSource, setCustomSource] = useState("");
  const [assetScope, setAssetScope] = useState("");
  const [cadence, setCadence] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [evidenceType, setEvidenceType] = useState("");
  const [title, setTitle] = useState("");
  const [controlId, setControlId] = useState("");
  const [checkId, setCheckId] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [owner, setOwner] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [pendingRemove, setPendingRemove] = useState<ExternalEvidenceArtifact | null>(null);
  const [pendingReview, setPendingReview] = useState<{
    item: ExternalEvidenceArtifact;
    status: "accepted" | "rejected";
  } | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");

  const registryKey = registryKeyForComposite(compositeId);
  const intake = useMemo(() => intakeConfigForComposite(compositeId), [compositeId]);
  const openAbsenceGaps = useMemo(
    () => openAbsenceGapChecks(checkIds, findingCountByCheck),
    [checkIds, findingCountByCheck],
  );
  const showIntakeWizard = registryKey !== null || openAbsenceGaps.length > 0;
  const remediateHref = findingsHrefForAbsenceGaps(checkIds, findingCountByCheck);

  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: () => api("/v1/settings", { schema: settingsSchema }),
    staleTime: 60_000,
  });

  const registryEntry = useMemo(() => {
    if (!registryKey) return null;
    return settingsQ.data?.evidence_source_categories?.find((c) => c.key === registryKey)?.entry ?? null;
  }, [registryKey, settingsQ.data?.evidence_source_categories]);

  const toolOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: `Select ${intake.toolLabel.toLowerCase()}…` },
      ...(intake.toolOptions ?? []).map((opt) => ({ value: opt, label: opt })),
    ],
    [intake],
  );

  const scopeOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: intake.scopePlaceholder },
      ...(intake.scopeOptions ?? []).map((opt) => ({ value: opt, label: opt })),
    ],
    [intake],
  );

  const cadenceOptions = useMemo<SelectOption[]>(() => cadenceOptionsForIntake(intake), [intake]);

  const evidenceTypeOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: "Select type (optional)" },
      ...EXTERNAL_EVIDENCE_TYPES.map((opt) => ({ value: opt, label: opt })),
    ],
    [],
  );

  const criterionOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: "None" },
      ...underlyingCriteria.map((c) => ({
        value: c.id,
        label: `${frameworkControlLabel(c.control_id)}${c.finding_count > 0 ? ` (${c.finding_count} findings)` : ""}`,
      })),
    ],
    [frameworkControlLabel, underlyingCriteria],
  );

  const checkOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: "None" },
      ...checkIds.map((id) => ({ value: id, label: labelForCheck(id) })),
    ],
    [checkIds],
  );

  const selectMenuProps = {
    menuZIndex: 70,
    maxMenuHeight: "16rem",
    menuClassName: "veritrail-select__menu--wrap",
  } as const;

  const evidenceQ = useQuery({
    queryKey: ["external-evidence", framework, compositeId],
    queryFn: () =>
      api<ExternalEvidenceArtifact[]>(
        `/v1/controls/evidence?framework=${encodeURIComponent(framework)}&composite_control_id=${encodeURIComponent(compositeId)}`,
      ),
    enabled: !!compositeId,
  });

  const resetForm = () => {
    setSource("");
    setCustomSource("");
    setAssetScope("");
    setCadence("");
    setPeriodEnd("");
    setEvidenceType("");
    setTitle("");
    setControlId("");
    setCheckId("");
    setExternalUrl("");
    setOwner("");
    setNote("");
    setFile(null);
    setError("");
    setModalStep(showIntakeWizard ? "wizard" : "form");
    if (fileRef.current) fileRef.current.value = "";
  };

  async function persistRegistryVendor(vendor: string) {
    if (!registryKey || !vendor.trim()) return;
    await api("/v1/settings", {
      method: "PATCH",
      body: JSON.stringify({
        evidence_sources: {
          entries: {
            [registryKey]: {
              vendor: vendor.trim(),
              owner: owner.trim() || null,
              cadence: cadence.trim() || null,
              scope_description: assetScope.trim() || null,
              source_type: "external_system",
            },
          },
        },
      }),
    });
    await qc.invalidateQueries({ queryKey: ["settings"] });
  }

  const submit = useMutation({
    mutationFn: async () => {
      const resolvedSource = (
        intake.useToolPicker ? (source === "Other" ? customSource : source) : customSource || source
      ).trim();
      if (!resolvedSource) throw new Error("Source is required");
      if (!file && !externalUrl.trim()) throw new Error("Upload a file or provide a link");

      const form = new FormData();
      form.append("framework", framework);
      form.append("composite_control_id", compositeId);
      form.append("source", resolvedSource);
      form.append("title", (title.trim() || `${resolvedSource} — ${compositeTitle}`).slice(0, 300));
      if (evidenceType) form.append("evidence_type", evidenceType);
      if (controlId) form.append("control_id", controlId);
      if (checkId) form.append("check_id", checkId);
      if (externalUrl.trim()) form.append("external_url", externalUrl.trim());
      if (owner.trim()) form.append("owner", owner.trim());
      if (note.trim()) form.append("note", note.trim());
      if (periodEnd.trim()) form.append("period_end", periodEnd.trim());
      if (file) form.append("file", file);

      const result = await apiUpload<ExternalEvidenceArtifact>("/v1/controls/evidence", form);
      if (registryKey) {
        await persistRegistryVendor(resolvedSource);
      }
      return result;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["external-evidence", framework, compositeId] });
      await qc.invalidateQueries({ queryKey: ["external-evidence", framework] });
      resetForm();
      setModalOpen(false);
    },
    onError: (err) => setError(formatApiError(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/v1/controls/evidence/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["external-evidence", framework, compositeId] });
      await qc.invalidateQueries({ queryKey: ["external-evidence", framework] });
      setPendingRemove(null);
    },
  });

  const review = useMutation({
    mutationFn: (v: { id: string; status: "accepted" | "rejected"; review_notes?: string }) =>
      api<ExternalEvidenceArtifact>(`/v1/controls/evidence/${v.id}/review`, {
        method: "PATCH",
        body: JSON.stringify({
          status: v.status,
          review_notes: v.review_notes?.trim() || undefined,
        }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["external-evidence", framework, compositeId] });
      await qc.invalidateQueries({ queryKey: ["external-evidence", framework] });
      setPendingReview(null);
      setReviewNotes("");
    },
    onError: (err) => setError(formatApiError(err)),
  });

  const closeModal = () => {
    if (submit.isPending) return;
    resetForm();
    setModalOpen(false);
  };

  const openModal = () => {
    setError("");
    resetForm();
    if (registryEntry?.vendor) {
      const known =
        intake.toolOptions && (intake.toolOptions as readonly string[]).includes(registryEntry.vendor)
          ? registryEntry.vendor
          : intake.useToolPicker
            ? "Other"
            : registryEntry.vendor;
      if (intake.useToolPicker) {
        setSource(known);
        if (known === "Other") setCustomSource(registryEntry.vendor);
      } else {
        setCustomSource(registryEntry.vendor);
      }
      if (registryEntry.scope_description) setAssetScope(registryEntry.scope_description);
      if (registryEntry.cadence) setCadence(registryEntry.cadence);
      if (registryEntry.owner) setOwner(registryEntry.owner);
    }
    setModalOpen(true);
  };

  function continueFromWizard() {
    const resolvedSource = (
      intake.useToolPicker ? (source === "Other" ? customSource : source) : customSource
    ).trim();
    if (!resolvedSource) {
      setError(`Enter ${intake.toolLabel.toLowerCase()}.`);
      return;
    }
    const scopeVal = intake.useScopePicker ? assetScope : assetScope.trim();
    if (!scopeVal) {
      setError(`Enter ${intake.scopeLabel.toLowerCase()}.`);
      return;
    }
    if (registryKey === "vulnerability_management" && !cadence) {
      setError("Select how often scans run.");
      return;
    }
    setError("");
    if (!evidenceType) setEvidenceType(intake.defaultEvidenceType);
    if (!title.trim()) {
      setTitle(
        registryKey === "vulnerability_management"
          ? buildVulnWizardTitle(resolvedSource, compositeTitle)
          : buildExternalWizardTitle(resolvedSource, compositeTitle),
      );
    }
    if (!note.trim()) {
      setNote(
        registryKey === "vulnerability_management"
          ? buildVulnWizardNote(scopeVal, cadence)
          : buildExternalCoverageNote(scopeVal, cadence),
      );
    }
    if (!intake.useToolPicker) setSource(resolvedSource);
    const gapCheck = openAbsenceGaps[0];
    if (gapCheck && !checkId) setCheckId(gapCheck);
    setModalStep("form");
  }

  async function downloadArtifact(item: ExternalEvidenceArtifact) {
    await downloadEvidenceArtifact(item);
  }

  useEffect(() => {
    if (!modalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeModal();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const items = evidenceQ.data ?? [];
  const acceptedCount = items.filter((item) => item.status === "accepted").length;
  const showGapBanner = compositeNeedsExternalEvidence(
    groupStatus,
    checkIds,
    findingCountByCheck,
    acceptedCount,
  );

  const modal =
    modalOpen && canEdit
      ? createPortal(
          <div
            className="compliance-external-evidence-modal__backdrop"
            onClick={closeModal}
            role="presentation"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={`ext-modal-title-${compositeId}`}
              className="compliance-external-evidence-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="compliance-external-evidence-modal__header">
                <div>
                  <h2 id={`ext-modal-title-${compositeId}`} className="compliance-external-evidence-modal__title">
                    Add external evidence
                  </h2>
                  <p className="compliance-external-evidence-modal__subtitle">{compositeTitle}</p>
                  <p className="compliance-external-evidence-modal__footnote">
                    Accepted evidence is included in Generate Audit Package exports under{" "}
                    <code>external-evidence/</code>.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  className="compliance-external-evidence-modal__close"
                  onClick={closeModal}
                  disabled={submit.isPending}
                >
                  ×
                </button>
              </div>

              {showIntakeWizard && modalStep === "wizard" ? (
                <div className="compliance-external-evidence__form">
                  <p className="compliance-external-evidence__wizard-lead">{intake.wizardLead}</p>
                  <div className="compliance-external-evidence__field">
                    <label>{intake.toolLabel}</label>
                    {intake.useToolPicker ? (
                      <>
                        <Select
                          value={source}
                          onChange={setSource}
                          options={toolOptions}
                          className="w-full"
                          {...selectMenuProps}
                        />
                        {source === "Other" && (
                          <input
                            className="compliance-external-evidence__input mt-2"
                            value={customSource}
                            onChange={(e) => setCustomSource(e.target.value)}
                            placeholder={intake.toolPlaceholder}
                            required
                          />
                        )}
                      </>
                    ) : (
                      <input
                        className="compliance-external-evidence__input"
                        value={customSource}
                        onChange={(e) => setCustomSource(e.target.value)}
                        placeholder={intake.toolPlaceholder}
                        required
                      />
                    )}
                  </div>
                  <div className="compliance-external-evidence__field">
                    <label>{intake.scopeLabel}</label>
                    {intake.useScopePicker ? (
                      <Select
                        value={assetScope}
                        onChange={setAssetScope}
                        options={scopeOptions}
                        className="w-full"
                        {...selectMenuProps}
                      />
                    ) : (
                      <input
                        className="compliance-external-evidence__input"
                        value={assetScope}
                        onChange={(e) => setAssetScope(e.target.value)}
                        placeholder={intake.scopePlaceholder}
                        required
                      />
                    )}
                  </div>
                  <div className="compliance-external-evidence__field">
                    <label>{intake.cadenceLabel}</label>
                    <Select
                      value={cadence}
                      onChange={setCadence}
                      options={cadenceOptions}
                      className="w-full"
                      {...selectMenuProps}
                    />
                  </div>
                  {error && <p className="compliance-external-evidence__error">{error}</p>}
                  <div className="compliance-external-evidence-modal__footer">
                    <button type="button" className="compliance-external-evidence-modal__cancel" onClick={closeModal}>
                      Cancel
                    </button>
                    <button type="button" className="compliance-external-evidence__submit" onClick={continueFromWizard}>
                      Continue to upload
                    </button>
                  </div>
                </div>
              ) : (
              <form
                className="compliance-external-evidence__form"
                onSubmit={(e) => {
                  e.preventDefault();
                  setError("");
                  submit.mutate();
                }}
              >
                {showIntakeWizard && (
                  <button
                    type="button"
                    className="compliance-external-evidence__wizard-back"
                    onClick={() => setModalStep("wizard")}
                  >
                    ← Back to intake questions
                  </button>
                )}

                <div className="compliance-external-evidence__field">
                  <label htmlFor={`ext-source-${compositeId}`}>Source / tool</label>
                  {intake.useToolPicker ? (
                    <Select
                      value={source}
                      onChange={setSource}
                      options={toolOptions}
                      className="w-full"
                      {...selectMenuProps}
                    />
                  ) : (
                    <input
                      id={`ext-source-${compositeId}`}
                      className="compliance-external-evidence__input"
                      value={customSource}
                      onChange={(e) => setCustomSource(e.target.value)}
                      placeholder={intake.toolPlaceholder}
                      required
                    />
                  )}
                  {intake.useToolPicker && source === "Other" && (
                    <input
                      className="compliance-external-evidence__input mt-2"
                      value={customSource}
                      onChange={(e) => setCustomSource(e.target.value)}
                      placeholder="Tool name"
                      required
                    />
                  )}
                </div>

                <div className="compliance-external-evidence__field">
                  <label>Evidence type</label>
                  <Select
                    value={evidenceType}
                    onChange={setEvidenceType}
                    options={evidenceTypeOptions}
                    className="w-full"
                    {...selectMenuProps}
                  />
                </div>

                {underlyingCriteria.length > 0 && (
                  <div className="compliance-external-evidence__field">
                    <label>Related criterion (optional)</label>
                    <Select
                      value={controlId}
                      onChange={setControlId}
                      options={criterionOptions}
                      className="w-full"
                      {...selectMenuProps}
                    />
                  </div>
                )}

                {checkIds.length > 0 && (
                  <div className="compliance-external-evidence__field">
                    <label>Related check (optional)</label>
                    <Select
                      value={checkId}
                      onChange={setCheckId}
                      options={checkOptions}
                      className="w-full"
                      {...selectMenuProps}
                    />
                  </div>
                )}

                <div className="compliance-external-evidence__field">
                  <label htmlFor={`ext-title-${compositeId}`}>Title</label>
                  <input
                    id={`ext-title-${compositeId}`}
                    className="compliance-external-evidence__input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Short label for auditors"
                  />
                </div>

                <div className="compliance-external-evidence__grid">
                  <div className="compliance-external-evidence__field">
                    <label htmlFor={`ext-file-${compositeId}`}>File</label>
                    <div className="compliance-external-evidence__file">
                      <label htmlFor={`ext-file-${compositeId}`} className="compliance-external-evidence__file-btn">
                        Choose file
                      </label>
                      <input
                        id={`ext-file-${compositeId}`}
                        ref={fileRef}
                        type="file"
                        className="compliance-external-evidence__file-input"
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.json,.md,.log"
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      />
                      <span className="compliance-external-evidence__file-name">
                        {file?.name ?? "No file chosen"}
                      </span>
                    </div>
                  </div>
                  <div className="compliance-external-evidence__field">
                    <label htmlFor={`ext-url-${compositeId}`}>Or link</label>
                    <input
                      id={`ext-url-${compositeId}`}
                      className="compliance-external-evidence__input"
                      type="url"
                      value={externalUrl}
                      onChange={(e) => setExternalUrl(e.target.value)}
                      placeholder="https://…"
                    />
                  </div>
                </div>

                <div className="compliance-external-evidence__field">
                  <label htmlFor={`ext-owner-${compositeId}`}>Owner</label>
                  <input
                    id={`ext-owner-${compositeId}`}
                    className="compliance-external-evidence__input"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    placeholder="Team or person responsible"
                  />
                </div>

                <div className="compliance-external-evidence__field">
                  <label htmlFor={`ext-period-${compositeId}`}>Coverage through (optional)</label>
                  <input
                    id={`ext-period-${compositeId}`}
                    className="compliance-external-evidence__input"
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                  />
                </div>

                <div className="compliance-external-evidence__field">
                  <label htmlFor={`ext-note-${compositeId}`}>Note</label>
                  <textarea
                    id={`ext-note-${compositeId}`}
                    className="compliance-external-evidence__textarea"
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What this evidence covers and any caveats for auditors"
                  />
                </div>

                {error && <p className="compliance-external-evidence__error">{error}</p>}

                <div className="compliance-external-evidence-modal__footer">
                  <button
                    type="button"
                    className="compliance-external-evidence-modal__cancel"
                    onClick={closeModal}
                    disabled={submit.isPending}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="compliance-external-evidence__submit" disabled={submit.isPending}>
                    {submit.isPending ? "Submitting…" : "Submit evidence"}
                  </button>
                </div>
              </form>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div className="compliance-external-evidence">
        <div className="compliance-external-evidence__header">
          <p className="compliance-group-card-title">External evidence</p>
          {canEdit && (
            <button type="button" className="compliance-external-evidence__add" onClick={openModal}>
              Add evidence
            </button>
          )}
        </div>

        <p className="compliance-external-evidence__hint">
          Document coverage from tools outside AWS when automated checks cannot see your scanner or process.
        </p>

        {registryEntry?.vendor && (
          <p className="compliance-external-evidence__registry">
            Workspace source: <strong>{registryEntry.vendor}</strong>
            {registryEntry.scope_description ? ` · ${registryEntry.scope_description}` : ""}
            {registryEntry.cadence ? ` · ${registryEntry.cadence}` : ""}
          </p>
        )}

        {showGapBanner && (
          <AbsenceGapCallout
            checkIds={checkIds}
            findingCountByCheck={findingCountByCheck}
            canEdit={canEdit}
            onAddEvidence={openModal}
            remediateHref={remediateHref}
          />
        )}

        {evidenceQ.isLoading ? (
          <p className="compliance-external-evidence__empty">Loading evidence…</p>
        ) : items.length === 0 ? (
          <p className="compliance-external-evidence__empty">No external evidence submitted for this group yet.</p>
        ) : (
          <ul className="compliance-external-evidence__list">
            {items.map((item) => {
              const stale = evidenceIsStale(item);
              return (
              <li key={item.id} className="compliance-external-evidence__item">
                <div className="compliance-external-evidence__item-main">
                  <p className="compliance-external-evidence__item-title">{item.title}</p>
                  <p className="compliance-external-evidence__item-meta">
                    {item.source && <span>{item.source}</span>}
                    {item.control_ref && <span>{frameworkControlLabel(item.control_ref)}</span>}
                    {item.check_id && <span>{labelForCheck(item.check_id)}</span>}
                    {item.created_at && <span>{formatEvidenceDate(item.created_at)}</span>}
                    {item.review_notes && <span title={item.review_notes}>Review note</span>}
                  </p>
                  {item.review_notes && (
                    <p className="compliance-external-evidence__review-note">{item.review_notes}</p>
                  )}
                  <EvidenceArtifactComments artifactId={item.id} canComment={canEdit || canReview} />
                </div>
                <div className="compliance-external-evidence__item-side">
                  <span
                    className={`compliance-external-evidence__status compliance-external-evidence__status--${
                      stale ? "stale" : item.status
                    }`}
                  >
                    {statusLabel(item.status, stale)}
                  </span>
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
                      onClick={() => downloadArtifact(item).catch((err) => setError(formatApiError(err)))}
                    >
                      Download
                    </button>
                  ) : (
                    <span className="compliance-external-evidence__filename">{evidenceKindLabel(item)}</span>
                  )}
                  {item.checksum_sha256 && (
                    <span className="compliance-external-evidence__checksum" title={item.checksum_sha256}>
                      SHA-256 {item.checksum_sha256.slice(0, 8)}…
                    </span>
                  )}
                  {canReview && item.status === "submitted" && (
                    <div className="compliance-external-evidence__review-actions">
                      <button
                        type="button"
                        className="compliance-external-evidence__review-accept"
                        disabled={review.isPending}
                        onClick={() => {
                          setReviewNotes("");
                          setPendingReview({ item, status: "accepted" });
                        }}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="compliance-external-evidence__review-reject"
                        disabled={review.isPending}
                        onClick={() => {
                          setReviewNotes("");
                          setPendingReview({ item, status: "rejected" });
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      className="compliance-external-evidence__remove"
                      onClick={() => setPendingRemove(item)}
                      disabled={remove.isPending}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            );
            })}
          </ul>
        )}
      </div>
      {modal}
      <ConfirmDialog
        open={!!pendingRemove}
        title="Remove external evidence?"
        description={
          pendingRemove
            ? `“${pendingRemove.title}” will be removed from this group. Uploaded files are deleted; this is logged in your org activity.`
            : ""
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (pendingRemove) remove.mutate(pendingRemove.id);
        }}
        onCancel={() => {
          if (!remove.isPending) setPendingRemove(null);
        }}
      />
      {pendingReview &&
        createPortal(
          <div
            className="compliance-external-evidence-modal__backdrop"
            onClick={() => !review.isPending && setPendingReview(null)}
            role="presentation"
          >
            <div
              role="dialog"
              aria-modal="true"
              className="compliance-external-evidence-modal compliance-external-evidence-modal--review"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="compliance-external-evidence-modal__header">
                <div>
                  <h2 className="compliance-external-evidence-modal__title">
                    {pendingReview.status === "accepted" ? "Accept evidence" : "Reject evidence"}
                  </h2>
                  <p className="compliance-external-evidence-modal__subtitle">{pendingReview.item.title}</p>
                </div>
              </div>
              <div className="compliance-external-evidence__field px-5 pb-2">
                <label htmlFor={`review-notes-${pendingReview.item.id}`}>Review notes (optional)</label>
                <textarea
                  id={`review-notes-${pendingReview.item.id}`}
                  className="compliance-external-evidence__textarea"
                  rows={3}
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Why this evidence is acceptable, or what is missing"
                />
              </div>
              {error && <p className="compliance-external-evidence__error px-5">{error}</p>}
              <div className="compliance-external-evidence-modal__footer">
                <button
                  type="button"
                  className="compliance-external-evidence-modal__cancel"
                  onClick={() => setPendingReview(null)}
                  disabled={review.isPending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={
                    pendingReview.status === "accepted"
                      ? "compliance-external-evidence__review-accept"
                      : "compliance-external-evidence__review-reject"
                  }
                  disabled={review.isPending}
                  onClick={() =>
                    review.mutate({
                      id: pendingReview.item.id,
                      status: pendingReview.status,
                      review_notes: reviewNotes,
                    })
                  }
                >
                  {review.isPending
                    ? "Saving…"
                    : pendingReview.status === "accepted"
                      ? "Accept"
                      : "Reject"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
