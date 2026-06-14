import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { auditorApi } from "../api";
import "../styles/auditor.css";

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
];

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
    <div className="aud-page space-y-5 pb-8">
      <div>
        <h1 className="aud-title">Compliance Matrix</h1>
        <p className="aud-subtitle">Read-only · control-to-finding mappings per framework.</p>
      </div>

      {/* Framework selector */}
      <div className="aud-seg">
        {FRAMEWORKS.map((fw) => (
          <button
            key={fw.key}
            type="button"
            onClick={() => setFramework(fw.key)}
            className={`aud-seg__btn${framework === fw.key ? " aud-seg__btn--active" : ""}`}
          >
            {fw.label}
          </button>
        ))}
      </div>

      {/* Score bar */}
      {data && (
        <div className="flex items-center gap-4">
          <div className="aud-posture">
            <span style={{ width: `${total ? (counts.pass / total) * 100 : 0}%`, background: "#10b981" }} />
            <span style={{ width: `${total ? (counts.fail / total) * 100 : 0}%`, background: "#f87171" }} />
            <span style={{ width: `${total ? (counts.no_data / total) * 100 : 0}%`, background: "#d4d4d8" }} />
          </div>
          <span className="text-2xl font-extrabold tabular-nums text-zinc-900">{score}%</span>
        </div>
      )}

      {/* Controls table */}
      {isLoading && <div className="py-8 text-sm text-zinc-400">Loading…</div>}

      {data && (
        <div className="aud-table-wrap">
          <table className="aud-table">
            <thead>
              <tr>
                <th className="w-24">Control ID</th>
                <th>Title</th>
                <th className="w-20">Status</th>
                <th className="w-20">Findings</th>
                <th className="w-20">Checks</th>
              </tr>
            </thead>
            <tbody>
              {data.map((ctrl) => (
                <tr key={ctrl.id}>
                  <td className="font-mono text-xs font-semibold text-zinc-700">{ctrl.control_id}</td>
                  <td>
                    <div className="aud-td-strong">{ctrl.title}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-zinc-500">{ctrl.description}</div>
                  </td>
                  <td>
                    <span className={`aud-pill aud-pill--${ctrl.status}`}>
                      <span className="aud-pill__dot" aria-hidden />
                      {ctrl.status === "no_data" ? "no data" : ctrl.status}
                    </span>
                  </td>
                  <td className="font-semibold tabular-nums text-zinc-900">{ctrl.finding_count}</td>
                  <td className="tabular-nums text-zinc-500">{ctrl.check_ids.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
