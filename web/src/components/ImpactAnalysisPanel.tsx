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

function ImpactChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100/80 px-2.5 py-1.5 text-[12px] font-medium text-zinc-600">
      <span className="text-zinc-400">{icon}</span>
      {label}
    </span>
  );
}

export function ImpactAnalysisEmpty({ onRun }: { onRun: () => void }) {
  return (
    <div className="impact-tab-content">
      <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm shadow-zinc-950/[0.02]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50 text-indigo-500">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.9} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l3.75 3.75L21.75 6" />
                </svg>
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Impact analysis</span>
            </div>
            <h3 className="mt-2.5 text-lg font-bold tracking-tight text-zinc-900">What happens if we fix this?</h3>
            <p className="mt-1 text-sm leading-relaxed text-zinc-500">
              Review recent usage, dependencies, and likely blast radius before remediation.
            </p>
          </div>
          <button
            type="button"
            onClick={onRun}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[#1e2a4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#18213b] active:scale-[0.99]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5h3.75v6H3v-6Zm6.75-6h3.75v12H9.75v-12Zm6.75-3h3.75v15H16.5v-15Z" />
            </svg>
            Analyze
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <ImpactChip
            label="Usage"
            icon={
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5h3.75v6H3v-6Zm6.75-6h3.75v12H9.75v-12Zm6.75-3h3.75v15H16.5v-15Z" />
              </svg>
            }
          />
          <ImpactChip
            label="Dependencies"
            icon={
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
              </svg>
            }
          />
          <ImpactChip
            label="Blast radius"
            icon={
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
              </svg>
            }
          />
        </div>
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
