import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiUpload, formatApiError } from "../api";
import { EXTERNAL_EVIDENCE_TYPES, type ExternalEvidenceArtifact } from "../lib/externalEvidence";
import { useAppScrollLock } from "../lib/useAppScrollLock";

export function CriterionEvidenceUploadModal({
  open,
  framework,
  controlId,
  controlRef,
  compositeId,
  checkIds,
  onClose,
}: {
  open: boolean;
  framework: string;
  controlId: string;
  controlRef: string;
  compositeId?: string | null;
  checkIds?: string[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("");
  const [evidenceType, setEvidenceType] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [owner, setOwner] = useState("");
  const [policyRef, setPolicyRef] = useState("");
  const [note, setNote] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  useAppScrollLock(open);

  const reset = () => {
    setSource("");
    setTitle("");
    setEvidenceType("");
    setExternalUrl("");
    setOwner("");
    setPolicyRef("");
    setNote("");
    setPeriodEnd("");
    setFile(null);
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = useMutation({
    mutationFn: async () => {
      const resolvedSource = source.trim();
      if (!resolvedSource) throw new Error("Source is required");
      if (!file && !externalUrl.trim()) throw new Error("Upload a file or provide a link");

      const form = new FormData();
      form.append("framework", framework);
      form.append("control_id", controlId);
      if (compositeId) form.append("composite_control_id", compositeId);
      form.append("source", resolvedSource);
      form.append(
        "title",
        (title.trim() || `${resolvedSource} — ${controlRef}`).slice(0, 300),
      );
      if (evidenceType) form.append("evidence_type", evidenceType);
      if (externalUrl.trim()) form.append("external_url", externalUrl.trim());
      if (owner.trim()) form.append("owner", owner.trim());
      if (policyRef.trim()) form.append("policy_ref", policyRef.trim());
      if (note.trim()) form.append("note", note.trim());
      if (periodEnd.trim()) form.append("period_end", periodEnd.trim());
      if (file) form.append("file", file);
      return apiUpload<ExternalEvidenceArtifact>("/v1/controls/evidence", form);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["external-evidence", framework] });
      if (compositeId) {
        await qc.invalidateQueries({ queryKey: ["external-evidence", framework, compositeId] });
      }
      reset();
      onClose();
    },
    onError: (err) => setError(formatApiError(err)),
  });

  if (!open) return null;

  return createPortal(
    <>
      <div className="control-evidence-slideover__backdrop" onClick={() => !submit.isPending && onClose()} aria-hidden />
      <div
        className="criterion-evidence-upload-modal finding-drawer-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="criterion-evidence-upload-title"
      >
        <header className="criterion-evidence-upload-modal__header">
          <button
            type="button"
            className="control-evidence-slideover__close"
            onClick={() => !submit.isPending && onClose()}
            aria-label="Close"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <p className="veritrail-kicker">External evidence</p>
          <h2 id="criterion-evidence-upload-title" className="text-lg font-semibold text-zinc-900">
            Add evidence for <span className="font-mono text-zinc-500">{controlRef}</span>
          </h2>
        </header>

        <form
          className="criterion-evidence-upload-modal__body"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <label className="compliance-external-evidence__field">
            <span>Source system or vendor</span>
            <input value={source} onChange={(e) => setSource(e.target.value)} required />
          </label>
          <label className="compliance-external-evidence__field">
            <span>Title (optional)</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="compliance-external-evidence__field">
            <span>Evidence type</span>
            <select value={evidenceType} onChange={(e) => setEvidenceType(e.target.value)}>
              <option value="">Select type (optional)</option>
              {EXTERNAL_EVIDENCE_TYPES.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
          <label className="compliance-external-evidence__field">
            <span>File</span>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.json,.md,.log"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="compliance-external-evidence__field">
            <span>Or external link</span>
            <input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://…" />
          </label>
          <label className="compliance-external-evidence__field">
            <span>Owner (optional)</span>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} />
          </label>
          <label className="compliance-external-evidence__field">
            <span>Linked policy (optional)</span>
            <input
              value={policyRef}
              onChange={(e) => setPolicyRef(e.target.value)}
              placeholder="e.g. ISMS-SEC-12 or policy URL slug"
            />
          </label>
          <label className="compliance-external-evidence__field">
            <span>Coverage through (optional)</span>
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </label>
          <label className="compliance-external-evidence__field">
            <span>Notes (optional)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </label>
          {checkIds && checkIds.length > 0 ? (
            <p className="text-xs text-zinc-500">
              Linked to {checkIds.length} automated check{checkIds.length === 1 ? "" : "s"} on this criterion.
            </p>
          ) : null}
          {error ? <p className="compliance-external-evidence__error">{error}</p> : null}
          <div className="criterion-evidence-upload-modal__actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={submit.isPending}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submit.isPending}>
              {submit.isPending ? "Uploading…" : "Submit for review"}
            </button>
          </div>
        </form>
      </div>
    </>,
    document.body,
  );
}
