import type { ReactNode } from "react";
import type { ImpactTone } from "../lib/impactAnalysisDisplay";
import "../styles/impact-analysis.css";

export function ImpactAnalysisShell({ children }: { children: ReactNode }) {
  return <div className="impact-analysis space-y-3">{children}</div>;
}

export type ImpactReportTab = "usage" | "dependencies" | "blast";

function CapabilityIcon({ paths }: { paths: string[] }) {
  return (
    <span className="impact-capability-tile-icon" aria-hidden>
      <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        {paths.map((d) => (
          <path key={d} strokeLinecap="round" strokeLinejoin="round" d={d} />
        ))}
      </svg>
    </span>
  );
}

const IMPACT_CAPABILITIES: {
  id: ImpactReportTab;
  title: string;
  iconPaths: string[];
}[] = [
  {
    id: "usage",
    title: "Usage",
    iconPaths: [
      "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281Z",
      "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    ],
  },
  {
    id: "dependencies",
    title: "Dependencies",
    iconPaths: [
      "M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244",
    ],
  },
  {
    id: "blast",
    title: "Blast radius",
    iconPaths: [
      "M12 2.75 14.2 9.25 21 12l-6.8 2.75L12 21.25 9.8 14.75 3 12l6.8-2.75L12 2.75Z",
    ],
  },
];

function ImpactCapabilityTile({ title, iconPaths }: { title: string; iconPaths: string[] }) {
  return (
    <div className="impact-capability-tile" aria-hidden>
      <CapabilityIcon paths={iconPaths} />
      <span className="impact-capability-tile-title">{title}</span>
    </div>
  );
}

function ImpactSectionIcon() {
  return (
    <span className="impact-section-icon" aria-hidden>
      <svg fill="none" stroke="currentColor" strokeWidth={1.9} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l3.75 3.75L21.75 6" />
      </svg>
    </span>
  );
}

export function ImpactAnalysisEmpty({ onRun }: { onRun: () => void }) {
  return (
    <div className="impact-tab-content">
      <div className="impact-empty-hero">
        <div className="impact-kicker-row">
          <ImpactSectionIcon />
          <p className="impact-preview-kicker">Impact review</p>
        </div>

        <h3 className="impact-empty-title">What changes if we fix this?</h3>

        <p className="impact-empty-lead">
          Review usage, dependencies, and blast radius before remediation.
        </p>

        <div className="impact-empty-footer">
          <div className="impact-capability-grid" aria-label="Analysis preview">
            {IMPACT_CAPABILITIES.map((cap) => (
              <ImpactCapabilityTile key={cap.id} title={cap.title} iconPaths={cap.iconPaths} />
            ))}
          </div>
          <button type="button" onClick={onRun} className="impact-analyze-button shrink-0">
            Analyze impact
          </button>
        </div>
      </div>
    </div>
  );
}

export function ImpactReportTabs({
  active,
  onChange,
}: {
  active: ImpactReportTab;
  onChange: (tab: ImpactReportTab) => void;
}) {
  return (
    <div className="impact-report-tabs" role="tablist" aria-label="Impact report sections">
      {IMPACT_CAPABILITIES.map((cap) => {
        const selected = active === cap.id;
        return (
          <button
            key={cap.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(cap.id)}
            className={`impact-report-tab ${selected ? "impact-report-tab--active" : ""}`}
          >
            {cap.title}
          </button>
        );
      })}
    </div>
  );
}

export function ImpactVerdictCard({
  tone,
  title,
  subtitle,
  detail,
  pill,
}: {
  tone: ImpactTone;
  title: string;
  subtitle: string;
  detail?: string;
  pill?: string;
}) {
  return (
    <div className={`impact-card impact-card--compact ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="impact-verdict">{title}</p>
          <p className="impact-subtitle">{subtitle}</p>
          {detail ? <p className="impact-detail">{detail}</p> : null}
        </div>
        {pill ? <span className={`impact-confidence-pill shrink-0 ${tone}`}>{pill}</span> : null}
      </div>
    </div>
  );
}

export function ImpactUsageStats({
  granted,
  recent,
  historical,
  safe,
}: {
  granted: number;
  recent: number;
  historical: number;
  safe: number;
}) {
  return (
    <div className="impact-stats">
      <div className="impact-stat">
        <div className="impact-stat-value">{granted}</div>
        <div className="impact-stat-label">Granted</div>
      </div>
      <div className="impact-stat">
        <div className="impact-stat-value recent">{recent}</div>
        <div className="impact-stat-label">Active</div>
      </div>
      <div className="impact-stat">
        <div className="impact-stat-value">{historical}</div>
        <div className="impact-stat-label">Historical</div>
      </div>
      <div className="impact-stat">
        <div className="impact-stat-value safe">{safe}</div>
        <div className="impact-stat-label">Cleanup candidates</div>
      </div>
    </div>
  );
}

export function ImpactReportEmpty({ message }: { message: string }) {
  return <p className="impact-report-empty">{message}</p>;
}
