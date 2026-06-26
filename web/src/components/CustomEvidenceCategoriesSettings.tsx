import { useEffect, useState } from "react";
import { api, formatApiError } from "../api";
import { settingsSchema } from "../lib/apiSchemas";
import { accessInput, accessPrimaryBtn } from "./accessUi";

type CategoryRow = { key: string; label: string };

type Props = {
  canEdit: boolean;
  onSaved?: () => void;
};

export function CustomEvidenceCategoriesSettings({ canEdit, onSaved }: Props) {
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api("/v1/settings", { schema: settingsSchema });
        if (!cancelled) {
          setRows(
            (data.custom_evidence_categories ?? []).map((c) => ({
              key: c.key,
              label: c.label,
            })),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function addRow() {
    if (rows.length >= 5) return;
    setRows((prev) => [...prev, { key: "", label: "" }]);
  }

  function updateRow(index: number, field: keyof CategoryRow, value: string) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    if (!canEdit) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await api("/v1/settings", {
        method: "PATCH",
        body: JSON.stringify({
          custom_evidence_categories: {
            entries: rows.filter((r) => r.key.trim() && r.label.trim()),
          },
        }),
        schema: settingsSchema,
      });
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-zinc-500">Loading custom categories…</p>;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-500">
        Define up to five org-specific evidence categories for intake and registry (lowercase key, e.g.{" "}
        <code className="text-xs">vendor_risk</code>).
      </p>
      {rows.map((row, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            className={accessInput}
            placeholder="key"
            value={row.key}
            disabled={!canEdit}
            onChange={(e) => updateRow(index, "key", e.target.value)}
          />
          <input
            className={accessInput}
            placeholder="Label"
            value={row.label}
            disabled={!canEdit}
            onChange={(e) => updateRow(index, "label", e.target.value)}
          />
          {canEdit ? (
            <button type="button" className="text-sm text-zinc-500 hover:text-red-600" onClick={() => removeRow(index)}>
              Remove
            </button>
          ) : null}
        </div>
      ))}
      {canEdit && rows.length < 5 ? (
        <button type="button" className="self-start text-sm font-medium text-indigo-600" onClick={addRow}>
          Add category
        </button>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {saved ? <p className="text-sm text-emerald-600">Saved.</p> : null}
      {canEdit ? (
        <button type="button" className={accessPrimaryBtn} disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save custom categories"}
        </button>
      ) : null}
    </div>
  );
}
