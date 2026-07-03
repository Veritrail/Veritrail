import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { z } from "zod";
import { useState } from "react";
import { FRAMEWORKS, frameworkLabel } from "../data/frameworks";

const questionnaireSchema = z.object({
  framework: z.string(),
  framework_label: z.string(),
  custom: z.boolean(),
  control_count: z.number(),
  controls: z.array(
    z.object({
      control_id: z.string(),
      title: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      guidance: z.string().nullable().optional(),
      check_ids: z.array(z.string()).optional(),
      short_answer: z.string().nullable().optional(),
      long_answer: z.string().nullable().optional(),
      evidence_refs: z.array(z.string()).optional(),
    }),
  ),
});

export default function Questionnaire() {
  const [framework, setFramework] = useState("soc2");
  const { data, isLoading, error } = useQuery({
    queryKey: ["questionnaire", framework],
    queryFn: () =>
      api(`/v1/controls/questionnaire?framework=${encodeURIComponent(framework)}`, {
        schema: questionnaireSchema,
      }),
  });

  const downloadJson = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `questionnaire-${framework}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">SOC 2 questionnaire</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Pre-written control narratives for auditor questionnaires and RFP responses.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            value={framework}
            onChange={(e) => setFramework(e.target.value)}
          >
            {FRAMEWORKS.map((fw) => (
              <option key={fw.id} value={fw.id}>
                {fw.label}
              </option>
            ))}
          </select>
          <button type="button" className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white" disabled={!data} onClick={downloadJson}>
            Export JSON
          </button>
        </div>
      </div>
      <p className="mb-4 text-sm text-zinc-500">
        Also included as <code>ai_pack_summary.json</code> companion in evidence packs. Custom org frameworks export via{" "}
        <code>org:slug</code> when configured in{" "}
        <Link to="/workspace#sharing" className="text-indigo-600 hover:underline">
          Workspace
        </Link>
        .
      </p>
      {isLoading && <p className="text-sm text-zinc-500">Loading questionnaire…</p>}
      {error && <p className="text-sm text-red-600">Failed to load questionnaire.</p>}
      {data && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">
            {frameworkLabel(framework)} · {data.control_count} controls
          </p>
          {data.controls.map((ctrl) => (
            <article key={ctrl.control_id} className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="font-semibold text-zinc-900">
                {ctrl.control_id}
                {ctrl.title ? ` — ${ctrl.title}` : ""}
              </h2>
              {ctrl.short_answer ? <p className="mt-2 text-sm font-medium text-zinc-700">{ctrl.short_answer}</p> : null}
              <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600">{ctrl.long_answer || ctrl.description}</p>
              {(ctrl.check_ids?.length ?? 0) > 0 ? (
                <p className="mt-2 text-xs text-zinc-400">{ctrl.check_ids!.length} mapped checks</p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
