import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, formatApiError } from "../api";
import { z } from "zod";
import { AccessCard, accessInput, accessPrimaryBtn } from "./accessUi";

const orgFrameworkSchema = z.object({
  slug: z.string(),
  label: z.string(),
  description: z.string().nullable().optional(),
  control_definitions: z.array(
    z.object({
      control_id: z.string(),
      title: z.string(),
      description: z.string().optional(),
      check_ids: z.array(z.string()),
    }),
  ),
  updated_at: z.string(),
});

const listSchema = z.array(orgFrameworkSchema);

export function CustomFrameworkSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["org-frameworks"],
    queryFn: () => api("/v1/controls/org-frameworks", { schema: listSchema }),
  });
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [controlId, setControlId] = useState("");
  const [controlTitle, setControlTitle] = useState("");
  const [checkIds, setCheckIds] = useState("");
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () =>
      api(`/v1/controls/org-frameworks/${encodeURIComponent(slug.trim())}`, {
        method: "PUT",
        body: JSON.stringify({
          slug: slug.trim(),
          label: label.trim(),
          control_definitions: [
            {
              control_id: controlId.trim(),
              title: controlTitle.trim() || controlId.trim(),
              check_ids: checkIds
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            },
          ],
        }),
        schema: orgFrameworkSchema,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-frameworks"] });
      qc.invalidateQueries({ queryKey: ["check-frameworks"] });
      setError("");
    },
    onError: (e) => setError(formatApiError(e)),
  });

  return (
    <AccessCard
      title="Custom frameworks"
      description="Define org-specific control frameworks beyond SOC 2 / CIS / ISO. Export via Questionnaire using org:slug."
    >
      {isLoading ? <p className="text-sm text-zinc-500">Loading…</p> : null}
      {(data ?? []).length > 0 ? (
        <ul className="mb-4 text-sm text-zinc-700">
          {data!.map((fw) => (
            <li key={fw.slug}>
              <span className="font-medium">{fw.label}</span> ({fw.slug}) — {fw.control_definitions.length} controls
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-zinc-500">No custom frameworks yet.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium">Slug</span>
          <input className={accessInput} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="internal-soc" />
        </label>
        <label className="text-sm">
          <span className="font-medium">Label</span>
          <input className={accessInput} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Internal SOC" />
        </label>
        <label className="text-sm">
          <span className="font-medium">Control ID</span>
          <input className={accessInput} value={controlId} onChange={(e) => setControlId(e.target.value)} placeholder="INT-1" />
        </label>
        <label className="text-sm">
          <span className="font-medium">Control title</span>
          <input className={accessInput} value={controlTitle} onChange={(e) => setControlTitle(e.target.value)} />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="font-medium">Check IDs (comma-separated)</span>
          <input className={accessInput} value={checkIds} onChange={(e) => setCheckIds(e.target.value)} placeholder="iam.root.mfa_not_enabled" />
        </label>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <button
        type="button"
        className={`${accessPrimaryBtn} mt-3`}
        disabled={!slug.trim() || !label.trim() || !controlId.trim() || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? "Saving…" : "Save framework"}
      </button>
    </AccessCard>
  );
}
