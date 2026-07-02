import { useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { auditorApi } from "../api";
import { useAuditorAsOf } from "../components/AuditorAsOf";
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

type ControlFinding = {
  id: string;
  check_id: string;
  resource_arn: string;
  title: string;
  severity: string;
  status: string;
};

type ControlSnapshot = {
  id: string;
  entity_type: string;
  entity_id: string;
  taken_at: string;
};

type ControlEvidence = {
  control_id: string;
  title: string;
  status: string;
  check_ids: string[];
  finding_count: number;
  findings: ControlFinding[];
  snapshots: ControlSnapshot[];
  as_of: string | null;
  note: string | null;
};

const FRAMEWORKS = [
  { key: "soc2", label: "SOC 2" },
  { key: "cis_aws_l1", label: "CIS AWS Foundations L1" },
];

const SEV_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#f59e0b",
  low: "#22c55e",
  info: "#94a3b8",
};

function ControlDetail({ controlDbId, asOf }: { controlDbId: string; asOf: string | null }) {
  const { data, isLoading } = useQuery<ControlEvidence>({
    queryKey: ["auditor-control-evidence", controlDbId, asOf],
    queryFn: () =>
      auditorApi(`/auditor/controls/${controlDbId}/evidence${asOf ? `?as_of=${asOf}` : ""}`),
  });

  if (isLoading) {
    return (
      <div className="aud-ctrl-detail">
        <p className="aud-ctrl-detail__empty">Loading evidence…</p>
      </div>
    );
  }
  if (!data) return null;

  const moreFindings = data.finding_count - data.findings.length;

  return (
    <div className="aud-ctrl-detail">
      {data.note && <p className="aud-ctrl-detail__empty">{data.note}</p>}
      <div className="aud-ctrl-detail__cols">
        {/* Findings — the "why" behind the status */}
        <div>
          <div className="aud-ctrl-detail__head">
            <span className="aud-ctrl-detail__title">Findings proving status</span>
            <span className="aud-ctrl-detail__count">{data.finding_count} open</span>
          </div>
          {data.findings.length === 0 ? (
            <p className="aud-ctrl-detail__empty">
              No open findings — control passes on the {asOf ? "sampled" : "latest"} scan.
            </p>
          ) : (
            <>
              {data.findings.map((f) => (
                <div key={f.id} className="aud-ctrl-finding">
                  <span
                    className="aud-ctrl-finding__sev"
                    style={{ background: SEV_COLOR[f.severity] ?? "#94a3b8" }}
                    aria-hidden
                  />
                  <div className="aud-ctrl-finding__body">
                    <div className="aud-ctrl-finding__title">{f.title}</div>
                    <div className="aud-ctrl-finding__res">{f.resource_arn || f.check_id}</div>
                  </div>
                </div>
              ))}
              {moreFindings > 0 && (
                <p className="aud-ctrl-detail__empty">
                  + {moreFindings} more open finding{moreFindings === 1 ? "" : "s"}
                </p>
              )}
            </>
          )}
        </div>

        {/* Evidence snapshots backing the control */}
        <div>
          <div className="aud-ctrl-detail__head">
            <span className="aud-ctrl-detail__title">Evidence snapshots</span>
            <span className="aud-ctrl-detail__count">{data.snapshots.length} shown</span>
          </div>
          {data.snapshots.length === 0 ? (
            <p className="aud-ctrl-detail__empty">
              No evidence snapshots{asOf ? " on or before this date" : ""}.
            </p>
          ) : (
            data.snapshots.map((s) => (
              <div key={s.id} className="aud-ctrl-snap">
                <span className="aud-ctrl-snap__type">{s.entity_type}</span>
                <span className="aud-ctrl-snap__id">{s.entity_id}</span>
                <span className="aud-ctrl-snap__when">
                  {s.taken_at ? new Date(s.taken_at).toLocaleDateString() : ""}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function AuditorControls() {
  const { asOf } = useAuditorAsOf();
  const [framework, setFramework] = useState("soc2");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<AuditorControl[]>({
    queryKey: ["auditor-controls", framework, asOf],
    queryFn: () =>
      auditorApi(`/auditor/controls?framework=${framework}${asOf ? `&as_of=${asOf}` : ""}`),
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
        <p className="aud-subtitle">
          Read-only · control-to-finding mappings per framework. Open a row to see the evidence behind each result.
        </p>
      </div>

      {/* Framework selector */}
      <div className="aud-seg">
        {FRAMEWORKS.map((fw) => (
          <button
            key={fw.key}
            type="button"
            onClick={() => {
              setFramework(fw.key);
              setExpandedId(null);
            }}
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
          <span className="text-2xl font-bold tabular-nums text-zinc-900">{score}%</span>
        </div>
      )}

      {/* Controls table */}
      {isLoading && <div className="py-8 text-sm text-zinc-400">Loading…</div>}

      {data && (
        <div className="aud-table-wrap">
          <table className="aud-table">
            <thead>
              <tr>
                <th className="w-28">Control ID</th>
                <th>Title</th>
                <th className="w-20">Status</th>
                <th className="w-20">Findings</th>
                <th className="w-20">Checks</th>
              </tr>
            </thead>
            <tbody>
              {data.map((ctrl) => {
                const open = expandedId === ctrl.id;
                return (
                  <Fragment key={ctrl.id}>
                    <tr
                      className="aud-row-toggle"
                      onClick={() => setExpandedId(open ? null : ctrl.id)}
                    >
                      <td className="font-mono text-xs font-semibold text-zinc-700">
                        <span className={`aud-row-toggle__chevron${open ? " aud-row-toggle__chevron--open" : ""}`}>
                          ▸
                        </span>{" "}
                        {ctrl.control_id}
                      </td>
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
                    {open && (
                      <tr>
                        <td colSpan={5} className="p-0">
                          <ControlDetail controlDbId={ctrl.id} asOf={asOf} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
