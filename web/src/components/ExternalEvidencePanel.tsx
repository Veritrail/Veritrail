import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiUpload, formatApiError } from "../api";
import { Select, type SelectOption } from "./Select";
import { labelForCheck } from "../data/checkLabels";
import { roleAtLeast, useMe } from "../hooks/useMe";
import {
  EXTERNAL_EVIDENCE_TYPES,
  EXTERNAL_SCANNER_SOURCES,
  type ExternalEvidenceArtifact,
  VULN_COMPOSITE_IDS,
} from "../lib/externalEvidence";

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

export function ExternalEvidencePanel({
  compositeId,
  compositeTitle,
  framework,
  checkIds,
  underlyingCriteria,
  frameworkControlLabel,
}: {
  compositeId: string;
  compositeTitle: string;
  framework: string;
  checkIds: string[];
  underlyingCriteria: UnderlyingCriterion[];
  frameworkControlLabel: (controlId: string) => string;
}) {
  const meQ = useMe();
  const canEdit = roleAtLeast(meQ.data?.role, "editor");
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [source, setSource] = useState("");
  const [customSource, setCustomSource] = useState("");
  const [evidenceType, setEvidenceType] = useState("");
  const [title, setTitle] = useState("");
  const [controlId, setControlId] = useState("");
  const [checkId, setCheckId] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [owner, setOwner] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  const isVulnGroup = VULN_COMPOSITE_IDS.has(compositeId);

  const sourceOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: "Select scanner or tool…" },
      ...EXTERNAL_SCANNER_SOURCES.map((opt) => ({ value: opt, label: opt })),
    ],
    [],
  );

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
    setEvidenceType("");
    setTitle("");
    setControlId("");
    setCheckId("");
    setExternalUrl("");
    setOwner("");
    setNote("");
    setFile(null);
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = useMutation({
    mutationFn: async () => {
      const resolvedSource = (isVulnGroup ? (source === "Other" ? customSource : source) : customSource || source).trim();
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
      if (file) form.append("file", file);

      return apiUpload<ExternalEvidenceArtifact>("/v1/controls/evidence", form);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["external-evidence", framework, compositeId] });
      resetForm();
      setModalOpen(false);
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
    setModalOpen(true);
  };

  useEffect(() => {
    if (!modalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeModal();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const items = evidenceQ.data ?? [];

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
                    Files are stored with your organization and linked to this group. They are not yet included in the audit package export.
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

              <form
                className="compliance-external-evidence__form"
                onSubmit={(e) => {
                  e.preventDefault();
                  setError("");
                  submit.mutate();
                }}
              >
                <div className="compliance-external-evidence__field">
                  <label htmlFor={`ext-source-${compositeId}`}>Source / tool</label>
                  {isVulnGroup ? (
                    <Select
                      value={source}
                      onChange={setSource}
                      options={sourceOptions}
                      className="w-full"
                      {...selectMenuProps}
                    />
                  ) : (
                    <input
                      id={`ext-source-${compositeId}`}
                      className="compliance-external-evidence__input"
                      value={customSource}
                      onChange={(e) => setCustomSource(e.target.value)}
                      placeholder="e.g. Jira, PagerDuty, internal runbook"
                      required
                    />
                  )}
                  {isVulnGroup && source === "Other" && (
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

        {evidenceQ.isLoading ? (
          <p className="compliance-external-evidence__empty">Loading evidence…</p>
        ) : items.length === 0 ? (
          <p className="compliance-external-evidence__empty">No external evidence submitted for this group yet.</p>
        ) : (
          <ul className="compliance-external-evidence__list">
            {items.map((item) => (
              <li key={item.id} className="compliance-external-evidence__item">
                <div className="compliance-external-evidence__item-main">
                  <p className="compliance-external-evidence__item-title">{item.title}</p>
                  <p className="compliance-external-evidence__item-meta">
                    {item.source && <span>{item.source}</span>}
                    {item.control_ref && <span>{frameworkControlLabel(item.control_ref)}</span>}
                    {item.check_id && <span>{labelForCheck(item.check_id)}</span>}
                    {item.created_at && <span>{formatEvidenceDate(item.created_at)}</span>}
                  </p>
                </div>
                <div className="compliance-external-evidence__item-side">
                  <span className="compliance-external-evidence__status">{item.status}</span>
                  {item.external_url ? (
                    <a
                      href={item.external_url}
                      target="_blank"
                      rel="noreferrer"
                      className="compliance-external-evidence__link"
                    >
                      Open link
                    </a>
                  ) : (
                    <span className="compliance-external-evidence__filename">{evidenceKindLabel(item)}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {modal}
    </>
  );
}
