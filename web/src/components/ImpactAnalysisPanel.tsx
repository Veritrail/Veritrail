import type { ReactNode } from "react";
import type { ImpactTone } from "../lib/impactAnalysisDisplay";
import "../styles/impact-analysis.css";

export function ImpactAnalysisShell({ children }: { children: ReactNode }) {
  return <div className="impact-analysis space-y-3">{children}</div>;
}

export type ImpactReportTab = "usage" | "dependencies" | "blast";

const IMPACT_CAPABILITIES: {
  id: ImpactReportTab;
  title: string;
  icon: ReactNode;
}[] = [
  {
    id: "usage",
    title: "Usage",
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5h3.75v6H3v-6Zm6.75-6h3.75v12H9.75v-12Zm6.75-3h3.75v15H16.5v-15Z" />
      </svg>
    ),
  },
  {
    id: "dependencies",
    title: "Dependencies",
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
      </svg>
    ),
  },
  {
    id: "blast",
    title: "Blast radius",
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z" />
      </svg>
    ),
  },
];

function ImpactCapabilityTile({ title, icon }: { title: string; icon: ReactNode }) {
  return (
    <div className="impact-capability-tile" aria-hidden>
      <span className="impact-capability-tile-icon">{icon}</span>
      <p className="impact-capability-tile-title">{title}</p>
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

        <div className="impact-title-row">
          <h3 className="impact-empty-title">What changes if we fix this?</h3>
          <button type="button" onClick={onRun} className="impact-analyze-button shrink-0">
            Analyze impact
          </button>
        </div>

        <p className="impact-empty-lead">
          Review usage, dependencies, and blast radius before remediation.
        </p>

        <div className="impact-capability-grid" aria-label="Analysis preview">
          {IMPACT_CAPABILITIES.map((cap) => (
            <ImpactCapabilityTile key={cap.id} title={cap.title} icon={cap.icon} />
          ))}
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
