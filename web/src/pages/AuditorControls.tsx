import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { auditorApi } from "../api";

type AuditorControl = {
  id: string;
  framework: string;
  control_id: string;
  title: string;
  description: string;
  check_ids: string[];
  status: string;
  finding_count: number;
};

const FRAMEWORKS = [
  { key: "soc2", label: "SOC 2" },
  { key: "cis_aws_l1", label: "CIS AWS Foundations L1" },
  { key: "iso27001", label: "ISO 27001" },
];

const statusBadge: Record<string, string> = {
  pass: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200",
  fail: "bg-red-100 text-red-700 ring-1 ring-red-200",
  no_data: "bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200",
};

export default function AuditorControls() {
  const [framework, setFramework] = useState("soc2");

  const { data, isLoading } = useQuery<AuditorControl[]>({
    queryKey: ["auditor-controls", framework],
    queryFn: () => auditorApi(`/auditor/controls?framework=${framework}`),
  });

  const counts = {
    pass: data?.filter((c) => c.status === "pass").length || 0,
    fail: data?.filter((c) => c.status === "fail").length || 0,
    no_data: data?.filter((c) => c.status === "no_data").length || 0,
  };
  const total = counts.pass + counts.fail + counts.no_data;
  const score = total > 0 ? Math.round((counts.pass / total) * 100) : 0;

  return (
    <div className="w-full space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Compliance Matrix</h1>
        <p className="mt-1 text-sm text-zinc-500">Read-only · control-to-finding mappings per framework.</p>
      </div>

      {/* Framework selector */}
      <div className="flex gap-2">
        {FRAMEWORKS.map((fw) => (
          <button
            key={fw.key}
            onClick={() => setFramework(fw.key)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              framework === fw.key
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50"
            }`}
          >
            {fw.label}
          </button>
        ))}
      </div>

      {/* Score bar */}
      {data && (
        <div className="flex items-center gap-4">
          <div className="flex-1 h-3 rounded-full bg-zinc-200 overflow-hidden">
            <div className="flex h-full">
              <div
                className="bg-emerald-500 transition-all"
                style={{ width: `${total ? (counts.pass / total) * 100 : 0}%` }}
              />
              <div
                className="bg-red-400 transition-all"
                style={{ width: `${total ? (counts.fail / total) * 100 : 0}%` }}
              />
              <div
                className="bg-zinc-300 transition-all"
                style={{ width: `${total ? (counts.no_data / total) * 100 : 0}%` }}
              />
            </div>
          </div>
          <span className="text-2xl font-bold tabular-nums text-zinc-900">{score}%</span>
        </div>
      )}

      {/* Controls table */}
      {isLoading && <div className="text-sm text-zinc-400 py-8">Loading…</div>}

      {data && (
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3 w-24">Control ID</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3 w-20">Status</th>
                <th className="px-4 py-3 w-20">Findings</th>
                <th className="px-4 py-3 w-24">Checks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {data.map((ctrl) => (
                <tr key={ctrl.id} className="hover:bg-zinc-50/50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-zinc-700">{ctrl.control_id}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-900">{ctrl.title}</div>
                    <div className="text-xs text-zinc-500">{ctrl.description}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadge[ctrl.status] || ""}`}>
                      {ctrl.status === "no_data" ? "no data" : ctrl.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums">{ctrl.finding_count}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">{ctrl.check_ids.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
