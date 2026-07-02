import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiUpload, formatApiError } from "../api";
import { DrawerDateField } from "./DrawerDateField";
import { Select, type SelectOption } from "./Select";
import { toIsoDate } from "../lib/isoDate";
import { labelForCheck } from "../data/checkLabels";
import { roleAtLeast, useMe } from "../hooks/useMe";
import { EXTERNAL_EVIDENCE_TYPES, type ExternalEvidenceArtifact } from "../lib/externalEvidence";
import { openAbsenceGapChecks } from "../lib/evidenceGap";
import { intakeConfigForComposite, scheduleOptionsForIntake } from "../lib/evidenceCategoryIntake";
import {
  buildExternalCoverageNote,
  buildExternalWizardTitle,
  buildVulnWizardNote,
  buildVulnWizardTitle,
  registryKeyForComposite,
} from "../lib/evidenceSourceRegistry";
type UnderlyingCriterion = {
  id: string;
  control_id: string;
  title: string;
  finding_count: number;
};

export function ExternalEvidencePanel({
  compositeId,
  compositeTitle,
  framework,
  checkIds,
  findingCountByCheck,
  underlyingCriteria,
  frameworkControlLabel,
  open,
  onOpenChange,
}: {
  compositeId: string;
  compositeTitle: string;
  framework: string;
  checkIds: string[];
  findingCountByCheck: Map<string, number>;
  underlyingCriteria: UnderlyingCriterion[];
  frameworkControlLabel: (controlId: string) => string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const meQ = useMe();
  const canEdit = roleAtLeast(meQ.data?.role, "editor");
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

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

  const registryKey = registryKeyForComposite(compositeId);
  const intake = useMemo(() => intakeConfigForComposite(compositeId), [compositeId]);
  const openAbsenceGaps = useMemo(
    () => openAbsenceGapChecks(checkIds, findingCountByCheck),
    [checkIds, findingCountByCheck],
  );
  const showIntakeWizard = registryKey !== null || openAbsenceGaps.length > 0;

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

  const scheduleOptions = useMemo<SelectOption[]>(() => scheduleOptionsForIntake(intake), [intake]);

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
      onOpenChange(false);
    },
    onError: (err) => setError(formatApiError(err)),
  });

  const closeModal = () => {
    if (submit.isPending) return;
    resetForm();
    onOpenChange(false);
  };

  useEffect(() => {
    if (!open) return;
    setError("");
    resetForm();
  }, [open, compositeId]);

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

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeModal();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (!open || !canEdit) return null;

  return createPortal(
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
            <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
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
              <label>{intake.scheduleLabel}</label>
              <Select
                value={cadence}
                onChange={setCadence}
                options={scheduleOptions}
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
              <DrawerDateField
                id={`ext-period-${compositeId}`}
                value={periodEnd}
                onChange={setPeriodEnd}
                placeholder="Select date"
                minIso={toIsoDate(new Date(new Date().getFullYear() - 20, 0, 1))}
                maxIso={toIsoDate(new Date())}
                variant="audit"
                triggerClassName="compliance-external-evidence__input drawer-date-field__trigger"
                popoverPlacement="below"
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
  );
}
