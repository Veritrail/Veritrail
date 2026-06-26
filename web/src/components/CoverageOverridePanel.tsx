import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../api";
import { roleAtLeast, useMe } from "../hooks/useMe";

type CoverageOverride = "out_of_scope" | "not_applicable" | null;

const OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "No override" },
  { value: "out_of_scope", label: "Out of scope" },
  { value: "not_applicable", label: "Not applicable" },
];

export function CoverageOverridePanel({
  compositeId,
  compositeTitle,
  coverageOverride,
}: {
  compositeId: string;
  compositeTitle: string;
  coverageOverride?: CoverageOverride;
}) {
  const meQ = useMe();
  const qc = useQueryClient();
  const canEdit = roleAtLeast(meQ.data?.role, "admin");
  const [value, setValue] = useState(coverageOverride ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setValue(coverageOverride ?? "");
  }, [coverageOverride, compositeId]);

  if (!canEdit) return null;

  const displayValue = value;

  async function handleChange(next: string) {
    setValue(next);
    setSaving(true);
    setError("");
    const override: CoverageOverride = next === "" ? null : (next as CoverageOverride);
    try {
      await api("/v1/settings", {
        method: "PATCH",
        body: JSON.stringify({
          coverage_overrides: { entries: { [compositeId]: override } },
        }),
      });
      await qc.invalidateQueries({ queryKey: ["controls", "composites"] });
    } catch (err) {
      setError(formatApiError(err));
      setValue(coverageOverride ?? "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/60 px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-800">Coverage override</p>
          <p className="text-meta leading-relaxed text-zinc-500">
            Mark <span className="font-medium text-zinc-700">{compositeTitle}</span> out of scope or not applicable for
            this audit.
          </p>
        </div>
        <select
          value={displayValue}
          disabled={saving}
          onChange={(e) => handleChange(e.target.value)}
          className="h-9 shrink-0 cursor-pointer rounded-lg border border-zinc-200 bg-white px-2.5 text-sm font-semibold text-zinc-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          aria-label={`Coverage override for ${compositeTitle}`}
        >
          {OPTIONS.map((opt) => (
            <option key={opt.value || "none"} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
