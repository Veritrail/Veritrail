import type { ReactNode } from "react";
import type { ImpactTone } from "../lib/impactAnalysisDisplay";
import "../styles/impact-analysis.css";

export function ImpactAnalysisShell({ children }: { children: ReactNode }) {
  return (
    <div className="impact-analysis space-y-3">
      <p className="impact-analysis-kicker">What happens if we fix this?</p>
      {children}
    </div>
  );
}

export function ImpactAnalysisEmpty({ onRun }: { onRun: () => void }) {
  return (
    <div className="impact-tab-content">
      <div className="impact-empty-card">
        <div className="impact-empty-copy">
          <p className="impact-analysis-kicker">What happens if we fix this?</p>
          <p className="impact-empty-description">
            Check recent usage, dependencies, and possible blast radius before remediation.
          </p>
        </div>
        <button type="button" onClick={onRun} className="impact-analyse-button">
          Run analysis
        </button>
      </div>
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
    <div className={`impact-card ${tone}`}>
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
        <div className="impact-stat-label">Safe cleanup</div>
      </div>
    </div>
  );
}
