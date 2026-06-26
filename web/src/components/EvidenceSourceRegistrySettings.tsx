import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatApiError } from "../api";
import { settingsSchema } from "../lib/apiSchemas";
import type { EvidenceSourceCategory } from "../lib/evidenceSourceRegistry";

type Props = {
  canEdit: boolean;
  onSaved?: () => void;
};

export function EvidenceSourceRegistrySettings({ canEdit, onSaved }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api("/v1/settings", { schema: settingsSchema }),
  });

  const categories = (data?.evidence_source_categories ?? []) as EvidenceSourceCategory[];
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!categories.length) return;
    const next: Record<string, string> = {};
    for (const cat of categories) {
      next[cat.key] = cat.entry?.vendor ?? "";
    }
    setDraft(next);
  }, [categories]);

  async function save() {
    if (!canEdit) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const entries: Record<string, { vendor: string | null }> = {};
      for (const cat of categories) {
        entries[cat.key] = { vendor: draft[cat.key]?.trim() || null };
      }
      await api("/v1/settings", {
        method: "PATCH",
        body: JSON.stringify({ evidence_sources: { entries } }),
      });
      setSaved(true);
      onSaved?.();
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return <p className="text-sm text-zinc-500">Loading evidence sources…</p>;
  }

  return (
    <div className="workspace-evidence-sources">
      <p className="workspace-evidence-sources__intro">
        Declare which external systems your team uses when Veritrail cannot verify coverage through AWS alone.
        These appear in audit packages and pre-fill vulnerability evidence uploads.
      </p>
      <ul className="workspace-evidence-sources__list">
        {categories.map((cat) => (
          <li key={cat.key} className="workspace-evidence-sources__row">
            <label htmlFor={`ev-src-${cat.key}`} className="workspace-evidence-sources__label">
              {cat.label}
            </label>
            <input
              id={`ev-src-${cat.key}`}
              className="workspace-evidence-sources__input"
              value={draft[cat.key] ?? ""}
              onChange={(e) => setDraft((prev) => ({ ...prev, [cat.key]: e.target.value }))}
              placeholder="e.g. Wiz, GitHub, Jira, PagerDuty"
              disabled={!canEdit || saving}
            />
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="workspace-evidence-sources__footer">
          <button type="button" className="workspace-evidence-sources__save" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save sources"}
          </button>
          {saved && <span className="workspace-evidence-sources__saved">Saved</span>}
          {error && <span className="workspace-evidence-sources__error">{error}</span>}
        </div>
      )}
    </div>
  );
}
