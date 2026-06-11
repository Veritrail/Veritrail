import type { ReactNode } from "react";
import type { ImpactTone } from "../lib/impactAnalysisDisplay";
import "../styles/impact-analysis.css";

export function ImpactAnalysisShell({ children }: { children: ReactNode }) {
  return <div className="impact-analysis space-y-3">{children}</div>;
}

export type ImpactReportTab = "usage" | "dependencies" | "blast";

function CapabilityIcon({ paths }: { paths: string[] }) {
  return (
    <span className="impact-capability-icon" aria-hidden>
      <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        {paths.map((d) => (
          <path key={d} strokeLinecap="round" strokeLinejoin="round" d={d} />
        ))}
      </svg>
    </span>
  );
}

const BLAST_TARGET_ICON = [
  "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
];

const IMPACT_CAPABILITIES: {
  id: ImpactReportTab;
  title: string;
  description: string;
  iconPaths: string[];
}[] = [
  {
    id: "usage",
    title: "Usage",
    description: "See how this role is used across your environment.",
    iconPaths: [
      "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z",
    ],
  },
  {
    id: "dependencies",
    title: "Dependencies",
    description: "View connected services and resources.",
    iconPaths: [
      "M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244",
    ],
  },
  {
    id: "blast",
    title: "Blast radius",
    description: "Estimate the potential impact of changes.",
    iconPaths: BLAST_TARGET_ICON,
  },
];

function ImpactHeroGraphic() {
  return (
    <div className="impact-empty-graphic" aria-hidden>
      <svg viewBox="0 0 64 64">
        <circle className="impact-pulse-ring impact-pulse-ring--1" cx="32" cy="32" r="10" />
        <circle className="impact-pulse-ring impact-pulse-ring--2" cx="32" cy="32" r="10" />
        <circle className="impact-pulse-ring impact-pulse-ring--3" cx="32" cy="32" r="10" />
        <circle className="impact-pulse-core-ring" cx="32" cy="32" r="9" />
        <circle className="impact-pulse-core" cx="32" cy="32" r="5" />
      </svg>
    </div>
  );
}

function ImpactCapabilityCard({
  title,
  description,
  iconPaths,
}: {
  title: string;
  description: string;
  iconPaths: string[];
}) {
  return (
    <li className="impact-capability-card">
      <div className="impact-capability-icon-box">
        <CapabilityIcon paths={iconPaths} />
      </div>
      <div className="impact-capability-copy">
        <p className="impact-capability-title">{title}</p>
        <p className="impact-capability-desc">{description}</p>
      </div>
    </li>
  );
}

export function ImpactAnalysisEmpty({ onRun }: { onRun: () => void }) {
  return (
    <div className="impact-tab-content">
      <div className="impact-empty-hero">
        <ImpactHeroGraphic />
        <h3 className="impact-empty-title">Understand the impact before you remediate</h3>
        <p className="impact-empty-lead">
          Analyze how this role is used, what it depends on, and how many permissions could be affected.
        </p>

        <ul className="impact-capability-list" aria-label="What the analysis covers">
          {IMPACT_CAPABILITIES.map((cap) => (
            <ImpactCapabilityCard
              key={cap.id}
              title={cap.title}
              description={cap.description}
              iconPaths={cap.iconPaths}
            />
          ))}
        </ul>

        <button type="button" onClick={onRun} className="impact-analyze-button impact-analyze-button--primary">
          <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          Analyze impact
        </button>
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

export type ImpactMetaValueTone = "default" | "ok" | "warn" | "bad" | "muted";

function impactMetaValueClass(
  base: "impact-meta-val" | "impact-meta-cell-value",
  { mono, tone, emphasis }: { mono?: boolean; tone?: ImpactMetaValueTone; emphasis?: boolean },
) {
  return [
    base,
    mono ? "mono" : "",
    emphasis ? "emphasis" : "",
    tone && tone !== "default" ? tone : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Stacked key/value rows — best for identity and repo metadata */
export function ImpactMetaPanel({ children }: { children: ReactNode }) {
  return <div className="impact-meta">{children}</div>;
}

export function ImpactMetaRow({
  label,
  value,
  mono,
  tone = "default",
  title,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  tone?: ImpactMetaValueTone;
  title?: string;
}) {
  return (
    <div className="impact-meta-row">
      <span className="impact-meta-key">{label}</span>
      <span className={impactMetaValueClass("impact-meta-val", { mono, tone })} title={title}>
        {value}
      </span>
    </div>
  );
}

/** Compact stat grid — best for AWS resource posture fields */
export function ImpactMetaGrid({
  cols = 2,
  children,
}: {
  cols?: 2 | 3;
  children: ReactNode;
}) {
  return <div className={`impact-meta-grid cols-${cols}`}>{children}</div>;
}

export function ImpactMetaCell({
  label,
  value,
  mono,
  tone = "default",
  span,
  emphasis,
  title,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  tone?: ImpactMetaValueTone;
  span?: 2 | 3;
  emphasis?: boolean;
  title?: string;
}) {
  return (
    <div className={`impact-meta-cell${span ? ` span-${span}` : ""}`}>
      <div className="impact-meta-cell-label">{label}</div>
      <div className={impactMetaValueClass("impact-meta-cell-value", { mono, tone, emphasis })} title={title}>
        {value}
      </div>
    </div>
  );
}

function AccessCompareListItem({
  tone,
  children,
}: {
  tone: "current" | "scoped";
  children: ReactNode;
}) {
  return (
    <li className={`impact-access-item impact-access-item--${tone}`}>
      {tone === "scoped" ? (
        <svg className="impact-access-item-icon" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      ) : (
        <span className="impact-access-item-dot" aria-hidden />
      )}
      <span>{children}</span>
    </li>
  );
}

export function ImpactAccessComparison({
  grantedActions,
  recentServices,
  hasWildcard,
  preservedServices,
  cleanupEligible,
}: {
  grantedActions: number;
  recentServices: number;
  hasWildcard: boolean;
  preservedServices: number;
  cleanupEligible: number;
}) {
  const grantedLabel = `${grantedActions.toLocaleString()} granted action${grantedActions === 1 ? "" : "s"}`;
  const recentLabel = `${recentServices.toLocaleString()} recently used service${recentServices === 1 ? "" : "s"}`;
  const preservedLabel = `${preservedServices.toLocaleString()} service${preservedServices === 1 ? "" : "s"} preserved`;
  const cleanupLabel = `${cleanupEligible.toLocaleString()} permission${cleanupEligible === 1 ? "" : "s"} eligible for cleanup`;

  return (
    <section className="impact-access-compare" aria-label="Current access vs reduced access">
      <h3 className="impact-access-compare-title">Current access vs reduced access</h3>
      <div className="impact-access-compare-grid">
        <div className="impact-access-panel impact-access-panel--current">
          <div className="impact-access-panel-head">
            <span className="impact-access-panel-icon impact-access-panel-icon--current" aria-hidden>
              <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
                />
              </svg>
            </span>
            <p className="impact-access-panel-title">Current state</p>
          </div>
          <ul className="impact-access-list">
            <AccessCompareListItem tone="current">{grantedLabel}</AccessCompareListItem>
            <AccessCompareListItem tone="current">{recentLabel}</AccessCompareListItem>
            <AccessCompareListItem tone="current">
              {hasWildcard ? "Broad wildcard permissions" : "No broad wildcard permissions"}
            </AccessCompareListItem>
          </ul>
        </div>

        <div className="impact-access-divider" aria-hidden>
          <span className="impact-access-divider-line" />
          <span className="impact-access-divider-arrow">
            <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </span>
        </div>

        <div className="impact-access-panel impact-access-panel--scoped">
          <div className="impact-access-panel-head">
            <span className="impact-access-panel-icon impact-access-panel-icon--scoped" aria-hidden>
              <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
                />
              </svg>
            </span>
            <p className="impact-access-panel-title">After scoped policy</p>
          </div>
          <ul className="impact-access-list">
            <AccessCompareListItem tone="scoped">{preservedLabel}</AccessCompareListItem>
            <AccessCompareListItem tone="scoped">{cleanupLabel}</AccessCompareListItem>
            <AccessCompareListItem tone="scoped">Lower lateral-movement risk</AccessCompareListItem>
          </ul>
        </div>
      </div>
    </section>
  );
}

function ImpactReportEmptyIcon({ variant }: { variant: "safe" | "neutral" }) {
  if (variant === "safe") {
    return (
      <div className="impact-report-empty-icon impact-report-empty-icon--safe" aria-hidden>
        <span className="impact-report-empty-pulse" />
        <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
          />
        </svg>
      </div>
    );
  }

  return (
    <div className="impact-report-empty-icon impact-report-empty-icon--neutral" aria-hidden>
      <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
        />
      </svg>
    </div>
  );
}

export function ImpactReportEmpty({
  title,
  subtitle,
  variant = "neutral",
}: {
  title: string;
  subtitle?: string;
  variant?: "safe" | "neutral";
}) {
  return (
    <div className={`impact-report-empty-state impact-report-empty-state--${variant}`}>
      <ImpactReportEmptyIcon variant={variant} />
      <p className="impact-report-empty-title">{title}</p>
      {subtitle ? <p className="impact-report-empty-subtitle">{subtitle}</p> : null}
    </div>
  );
}
