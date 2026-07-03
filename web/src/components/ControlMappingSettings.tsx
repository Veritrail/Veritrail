import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../api";
import { labelForCheck } from "../data/checkLabels";
import { roleAtLeast, useMe } from "../hooks/useMe";
import { accessInput, accessPrimaryBtn } from "./accessUi";
import { frameworkLabel } from "../data/frameworks";

type MappingRow = {
  framework: string;
  control_id: string;
  global_check_ids: string[];
  added_check_ids: string[];
  removed_check_ids: string[];
  effective_check_ids: string[];
  has_override: boolean;
};

type Props = {
  framework?: string;
  canEdit?: boolean;
};

function parseCheckList(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ControlMappingSettings({ framework = "soc2", canEdit: canEditProp }: Props) {
  const meQ = useMe();
  const qc = useQueryClient();
  const canEdit = canEditProp ?? roleAtLeast(meQ.data?.role, "admin");
  const [selected, setSelected] = useState<string>("");
  const [addedText, setAddedText] = useState("");
  const [removedText, setRemovedText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const mappingsQ = useQuery({
    queryKey: ["controls", "control-mappings", framework],
    queryFn: () =>
      api(`/v1/controls/control-mappings?framework=${encodeURIComponent(framework)}`) as Promise<
        MappingRow[]
      >,
  });

  const rows = mappingsQ.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((r) => r.control_id === selected) ?? null,
    [rows, selected],
  );

  useEffect(() => {
    if (!selected && rows.length) {
      const firstOverride = rows.find((r) => r.has_override);
      setSelected((firstOverride ?? rows[0]).control_id);
    }
  }, [rows, selected]);

  useEffect(() => {
    if (!selectedRow) return;
    setAddedText(selectedRow.added_check_ids.join("\n"));
    setRemovedText(selectedRow.removed_check_ids.join("\n"));
    setSaved(false);
  }, [selectedRow?.control_id, selectedRow?.added_check_ids, selectedRow?.removed_check_ids]);

  async function save() {
    if (!canEdit || !selected) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await api(`/v1/controls/control-mappings/${framework}/${encodeURIComponent(selected)}`, {
        method: "PUT",
        body: JSON.stringify({
          added_check_ids: parseCheckList(addedText),
          removed_check_ids: parseCheckList(removedText),
        }),
      });
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ["controls"] });
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function clearOverride() {
    if (!canEdit || !selected) return;
    setSaving(true);
    setError("");
    try {
      await api(`/v1/controls/control-mappings/${framework}/${encodeURIComponent(selected)}`, {
        method: "DELETE",
      });
      setAddedText("");
      setRemovedText("");
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ["controls"] });
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  }

  if (mappingsQ.isLoading) {
    return <p className="text-sm text-zinc-500">Loading control mappings…</p>;
  }

  if (mappingsQ.isError) {
    return <p className="text-sm text-red-600">{formatApiError(mappingsQ.error)}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-500">
        Customize which Veritrail checks roll up to each {frameworkLabel(framework)} control for this
        workspace. Effective checks = (global ∪ added) − removed. Changes affect compliance status and
        evidence packs without forking global mappings.
      </p>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-700">Control</span>
          <select
            className={accessInput}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {rows.map((row) => (
              <option key={row.control_id} value={row.control_id}>
                {row.control_id}
                {row.has_override ? " · customized" : ""}
              </option>
            ))}
          </select>
        </label>
        {canEdit && selectedRow?.has_override ? (
          <button
            type="button"
            className="text-sm font-medium text-zinc-500 hover:text-red-600"
            disabled={saving}
            onClick={clearOverride}
          >
            Reset to global
          </button>
        ) : null}
      </div>
      {selectedRow ? (
        <details className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2 text-sm text-zinc-600">
          <summary className="cursor-pointer font-medium text-zinc-800">
            Global checks ({selectedRow.global_check_ids.length})
          </summary>
          <ul className="mt-2 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5">
            {selectedRow.global_check_ids.map((id) => (
              <li key={id}>
                <code className="text-xs">{id}</code>
                <span className="text-zinc-500"> — {labelForCheck(id)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-zinc-700">Added check IDs (one per line)</span>
        <textarea
          className={`${accessInput} min-h-[88px] font-mono text-xs`}
          value={addedText}
          disabled={!canEdit}
          placeholder="iam.policy.unattached"
          onChange={(e) => setAddedText(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-zinc-700">Removed check IDs (one per line)</span>
        <textarea
          className={`${accessInput} min-h-[88px] font-mono text-xs`}
          value={removedText}
          disabled={!canEdit}
          placeholder="github.org.dormant_members"
          onChange={(e) => setRemovedText(e.target.value)}
        />
      </label>
      {selectedRow ? (
        <p className="text-meta text-zinc-500">
          Effective: {selectedRow.effective_check_ids.length} check
          {selectedRow.effective_check_ids.length === 1 ? "" : "s"}
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {saved ? <p className="text-sm text-emerald-600">Saved.</p> : null}
      {canEdit ? (
        <button type="button" className={accessPrimaryBtn} disabled={saving || !selected} onClick={save}>
          {saving ? "Saving…" : "Save mapping override"}
        </button>
      ) : (
        <p className="text-sm text-zinc-500">Admin access required to edit mappings.</p>
      )}
    </div>
  );
}
