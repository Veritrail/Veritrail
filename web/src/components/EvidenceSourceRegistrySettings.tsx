import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatApiError } from "../api";
import { settingsSchema } from "../lib/apiSchemas";
import type { EvidenceSourceCategory, EvidenceSourceEntry } from "../lib/evidenceSourceRegistry";
import { VULN_SCAN_CADENCES } from "../lib/evidenceSourceRegistry";

type Props = {
  canEdit: boolean;
  onSaved?: () => void;
};

type CategoryDraft = {
  vendor: string;
  owner: string;
  cadence: string;
  scope_description: string;
  source_type: string;
};

const EMPTY_DRAFT: CategoryDraft = {
  vendor: "",
  owner: "",
  cadence: "",
  scope_description: "",
  source_type: "",
};

const SOURCE_TYPE_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "external_system", label: "External system" },
  { value: "manual_attestation", label: "Manual attestation" },
];

function draftFromEntry(entry: EvidenceSourceEntry | null | undefined): CategoryDraft {
  if (!entry) return { ...EMPTY_DRAFT };
  return {
    vendor: entry.vendor ?? "",
    owner: entry.owner ?? "",
    cadence: entry.cadence ?? "",
    scope_description: entry.scope_description ?? "",
    source_type: entry.source_type ?? "",
  };
}

export function EvidenceSourceRegistrySettings({ canEdit, onSaved }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api("/v1/settings", { schema: settingsSchema }),
  });

  const categories = (data?.evidence_source_categories ?? []) as EvidenceSourceCategory[];
  const [draft, setDraft] = useState<Record<string, CategoryDraft>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!categories.length) return;
    const next: Record<string, CategoryDraft> = {};
    for (const cat of categories) {
      next[cat.key] = draftFromEntry(cat.entry);
    }
    setDraft(next);
  }, [categories]);

  function updateField(key: string, field: keyof CategoryDraft, value: string) {
    setDraft((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? EMPTY_DRAFT), [field]: value },
    }));
  }

  async function save() {
    if (!canEdit) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const entries: Record<
        string,
        {
          vendor: string | null;
          owner?: string | null;
          cadence?: string | null;
          scope_description?: string | null;
          source_type?: string | null;
        }
      > = {};
      for (const cat of categories) {
        const row = draft[cat.key] ?? EMPTY_DRAFT;
        const vendor = row.vendor.trim();
        if (!vendor) {
          entries[cat.key] = { vendor: null };
          continue;
        }
        entries[cat.key] = {
          vendor,
          owner: row.owner.trim() || null,
          cadence: row.cadence.trim() || null,
          scope_description: row.scope_description.trim() || null,
          source_type: row.source_type.trim() || null,
        };
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
        Vendor is required to save a category; owner, cadence, scope, and source type are optional questionnaire fields
        included in audit packages and upload pre-fill.
      </p>
      <ul className="workspace-evidence-sources__list">
        {categories.map((cat) => {
          const row = draft[cat.key] ?? EMPTY_DRAFT;
          return (
            <li key={cat.key} className="workspace-evidence-sources__category">
              <p className="workspace-evidence-sources__category-title">{cat.label}</p>
              <div className="workspace-evidence-sources__fields">
                <label className="workspace-evidence-sources__field">
                  <span className="workspace-evidence-sources__field-label">Vendor / tool</span>
                  <input
                    className="workspace-evidence-sources__input"
                    value={row.vendor}
                    onChange={(e) => updateField(cat.key, "vendor", e.target.value)}
                    placeholder="e.g. Wiz, GitHub, Jira, PagerDuty"
                    disabled={!canEdit || saving}
                  />
                </label>
                <label className="workspace-evidence-sources__field">
                  <span className="workspace-evidence-sources__field-label">Owner (optional)</span>
                  <input
                    className="workspace-evidence-sources__input"
                    value={row.owner}
                    onChange={(e) => updateField(cat.key, "owner", e.target.value)}
                    placeholder="e.g. Security team, Platform eng"
                    disabled={!canEdit || saving}
                  />
                </label>
                <label className="workspace-evidence-sources__field">
                  <span className="workspace-evidence-sources__field-label">Cadence (optional)</span>
                  <input
                    className="workspace-evidence-sources__input"
                    value={row.cadence}
                    onChange={(e) => updateField(cat.key, "cadence", e.target.value)}
                    placeholder="e.g. Weekly, Continuous"
                    list={`ev-src-cadence-${cat.key}`}
                    disabled={!canEdit || saving}
                  />
                  <datalist id={`ev-src-cadence-${cat.key}`}>
                    {VULN_SCAN_CADENCES.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </label>
                <label className="workspace-evidence-sources__field workspace-evidence-sources__field--wide">
                  <span className="workspace-evidence-sources__field-label">Scope (optional)</span>
                  <input
                    className="workspace-evidence-sources__input"
                    value={row.scope_description}
                    onChange={(e) => updateField(cat.key, "scope_description", e.target.value)}
                    placeholder="e.g. Production AWS accounts and container images"
                    disabled={!canEdit || saving}
                  />
                </label>
                <label className="workspace-evidence-sources__field">
                  <span className="workspace-evidence-sources__field-label">Source type (optional)</span>
                  <select
                    className="workspace-evidence-sources__input"
                    value={row.source_type}
                    onChange={(e) => updateField(cat.key, "source_type", e.target.value)}
                    disabled={!canEdit || saving}
                  >
                    {SOURCE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value || "none"} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </li>
          );
        })}
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
