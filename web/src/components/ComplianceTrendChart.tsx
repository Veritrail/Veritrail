import { useState } from "react";
import type { HistoryEvent, PeriodSummary } from "../lib/complianceHistory";
import type { ImpactItem } from "../lib/historyPresentation";
import { ImpactList } from "./ImpactList";
import { causeSentence, impactItems } from "../lib/historyPresentation";

type ChartPoint = {
  date: string;
  score: number | null;
  failing: number;
  findingsOpened: number;
  findingsResolved: number;
  scanRunId: string;
  isBaseline: boolean;
  event: HistoryEvent;
};

function buildPoints(events: HistoryEvent[]): ChartPoint[] {
  return [...events].reverse().map((e) => ({
    date: e.timestamp.slice(0, 10),
    score: e.posture_after,
    failing: e.controls_failed_after ?? e.snapshot?.controls_failed ?? 0,
    findingsOpened: e.findings_opened,
    findingsResolved: e.findings_resolved,
    scanRunId: e.scan_run_id,
    isBaseline: e.type === "baseline_established",
    event: e,
  }));
}

function buildStory(events: HistoryEvent[], summary?: PeriodSummary): ImpactItem[] {
  const changeEvents = events.filter((e) => e.type !== "baseline_established");
  const findingsIntroduced = changeEvents.reduce((s, e) => s + e.findings_opened, 0);
  const findingsResolved = changeEvents.reduce((s, e) => s + e.findings_resolved, 0);
  const regressed = summary?.controls_regressed ?? changeEvents.reduce((s, e) => s + e.new_failures_count, 0);
  const improved = summary?.controls_improved ?? changeEvents.reduce((s, e) => s + e.resolved_count, 0);

  const items: ImpactItem[] = [];
  if (findingsIntroduced > 0)
    items.push({ value: findingsIntroduced, label: "findings introduced", tone: "bad", direction: "up" });
  if (regressed > 0)
    items.push({ value: regressed, label: `control${regressed === 1 ? "" : "s"} regressed`, tone: "bad", direction: "up" });
  if (improved > 0)
    items.push({ value: improved, label: `control${improved === 1 ? "" : "s"} improved`, tone: "good", direction: "down" });
  if (findingsResolved > 0)
    items.push({ value: findingsResolved, label: "findings resolved", tone: "good", direction: "down" });
  return items;
}

const CHART_W = 560;
const CHART_H_DEFAULT = 160;
const CHART_H_COMPACT = 96;
const PAD_X = 36;
const PAD_Y = 10;
const Y_TICKS = [0, 25, 50, 75, 100];

function fmtDay(date: string) {
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function PointDetailPanel({
  point,
  onViewEvidence,
}: {
  point: ChartPoint;
  onViewEvidence: (scanRunId: string) => void;
}) {
  const cause = causeSentence(point.event);
  const impacts = impactItems(point.event);

  return (
    <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[13px] font-semibold text-zinc-600">{fmtDay(point.date)}</span>
        <span className="text-2xl font-bold tabular-nums tracking-tight text-zinc-950">
          {point.score != null ? `${point.score}%` : "—"}
        </span>
        <span className="rounded-md bg-white px-1.5 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200/70">
          {point.failing} failing
        </span>
        {point.findingsOpened > 0 && (
          <span className="text-xs text-rose-600">+{point.findingsOpened} findings</span>
        )}
        {point.findingsResolved > 0 && (
          <span className="text-xs text-emerald-600">{point.findingsResolved} resolved</span>
        )}
      </div>

      {cause && point.event.type !== "baseline_established" && (
        <p className="mt-2 text-sm leading-snug text-zinc-700">
          <span className="font-medium text-zinc-900">{cause.control}</span>{" "}
          <span className={cause.tone === "bad" ? "text-rose-600" : cause.tone === "good" ? "text-emerald-600" : "text-zinc-500"}>
            {cause.text}
          </span>
        </p>
      )}

      {impacts.length > 0 && (
        <div className="mt-3">
          <ImpactList items={impacts} size="sm" />
        </div>
      )}

      <button
        type="button"
        onClick={() => onViewEvidence(point.scanRunId)}
        className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-indigo-700 hover:text-indigo-900"
      >
        View evidence &amp; controls →
      </button>
    </div>
  );
}

export function ComplianceTrendChart({
  events,
  currentScore,
  days,
  periodSummary,
  onSelectSnapshot,
  compact = false,
}: {
  events: HistoryEvent[];
  currentScore: number | null | undefined;
  days: number;
  periodSummary?: PeriodSummary;
  onSelectSnapshot?: (scanRunId: string) => void;
  compact?: boolean;
}) {
  const points = buildPoints(events);
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const scoreVals = points.map((p) => p.score).filter((v): v is number => v != null);
  const latest = currentScore ?? scoreVals[scoreVals.length - 1] ?? null;
  const earliest = scoreVals[0] ?? null;
  const delta = earliest != null && latest != null ? latest - earliest : null;
  const story = buildStory(events, periodSummary);
  const CHART_H = compact ? CHART_H_COMPACT : CHART_H_DEFAULT;

  const innerW = CHART_W - PAD_X * 2;
  const xAt = (i: number) =>
    PAD_X + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yScore = (v: number) => PAD_Y + (CHART_H - PAD_Y * 2) * (1 - v / 100);

  const coords = points.map((p, i) => (p.score == null ? null : { x: xAt(i), y: yScore(p.score) }));
  const line = coords.filter(Boolean).map((c) => `${c!.x},${c!.y}`).join(" ");
  const area =
    line.length > 0
      ? `${xAt(0)},${CHART_H - PAD_Y} ${line} ${xAt(points.length - 1)},${CHART_H - PAD_Y}`
      : "";

  const activeI = hover ?? selected ?? null;

  function handlePointClick(i: number) {
    setSelected(selected === i ? null : i);
  }

  if (compact) {
    return (
      <div className="w-full">
        {points.length >= 1 ? (
          <>
            <div className="relative overflow-visible" style={{ height: CHART_H }}>
              <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="absolute inset-0 h-full w-full" style={{ overflow: "visible" }}>
                <defs>
                  <linearGradient id="scoreFillCompact" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(99 102 241)" stopOpacity={0.14} />
                    <stop offset="100%" stopColor="rgb(99 102 241)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                {Y_TICKS.filter((t) => t % 50 === 0).map((t) => {
                  const y = yScore(t);
                  return (
                    <g key={t}>
                      <line x1={PAD_X} x2={CHART_W - 8} y1={y} y2={y} stroke="rgb(244 244 245)" strokeWidth={1} />
                      <text x={PAD_X - 6} y={y + 3} textAnchor="end" fill="rgb(161 161 170)" style={{ fontSize: 8 }}>
                        {t}
                      </text>
                    </g>
                  );
                })}
                {area && <polygon points={area} fill="url(#scoreFillCompact)" />}
                {line && (
                  <polyline points={line} fill="none" stroke="rgb(79 70 229)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                )}
                {points.map((p, i) => {
                  const c = coords[i];
                  return (
                    <g key={p.scanRunId}>
                      <rect
                        x={xAt(i) - innerW / Math.max(1, points.length) / 2}
                        y={0}
                        width={innerW / Math.max(1, points.length)}
                        height={CHART_H}
                        fill="transparent"
                        className="cursor-pointer"
                        onMouseEnter={() => setHover(i)}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => setSelected(selected === i ? null : i)}
                      />
                      {c && (
                        <circle cx={c.x} cy={c.y} r={hover === i || selected === i ? 5 : 3.5} fill="white" stroke="rgb(79 70 229)" strokeWidth={2} />
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="mt-1 flex justify-between pl-8 pr-1 text-[10px] tabular-nums text-zinc-400">
              <span>{fmtDay(points[0].date)}</span>
              {points.length > 1 && <span>{fmtDay(points[points.length - 1].date)}</span>}
            </div>
            {selected != null && points[selected] && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-zinc-600">
                  {fmtDay(points[selected].date)} · <span className="font-semibold tabular-nums text-zinc-900">{points[selected].score ?? "—"}%</span>
                </span>
                <button
                  type="button"
                  onClick={() => onSelectSnapshot?.(points[selected].scanRunId)}
                  className="font-medium text-indigo-600 hover:text-indigo-800"
                >
                  View evidence
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-zinc-500">Run more scans to see posture trend.</p>
        )}
      </div>
    );
  }

  return (
    <section className="w-full rounded-2xl border border-zinc-200/90 bg-white px-5 py-5 shadow-sm shadow-zinc-950/[0.04] sm:px-6 sm:py-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="lg:w-[280px] lg:shrink-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Compliance posture · last {days} days
          </p>
          <div className="mt-3 flex items-baseline gap-2.5">
            {earliest != null && latest != null && earliest !== latest ? (
              <span className="flex items-baseline gap-2 text-4xl font-bold tabular-nums tracking-tight">
                <span className="text-zinc-300">{earliest}%</span>
                <span className="text-2xl font-normal text-zinc-300">→</span>
                <span className={delta != null && delta < 0 ? "text-rose-700" : "text-emerald-700"}>{latest}%</span>
              </span>
            ) : (
              <span className="text-4xl font-bold tabular-nums tracking-tight text-zinc-950">
                {latest != null ? `${latest}%` : "—"}
              </span>
            )}
            {delta != null && delta !== 0 && (
              <span
                className={`rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${
                  delta < 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
                }`}
              >
                {delta > 0 ? "+" : "−"}
                {Math.abs(delta)} pts
              </span>
            )}
          </div>

          {story.length > 0 ? (
            <div className="mt-5">
              <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                What drove the change
              </p>
              <ImpactList items={story} size="sm" />
            </div>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">No posture-changing events in this window.</p>
          )}
        </div>

        {/* Right: chart */}
        <div className="min-w-0 flex-1">
          {points.length >= 1 ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Score over time
                </p>
                <p className="text-[10px] text-zinc-400">Click a point for details</p>
              </div>

              {/*
                Tooltip positioning: wrap SVG + tooltip in a relative div that matches
                the SVG's rendered dimensions. Tooltip uses percentage-based left and
                bottom so it tracks the data point regardless of container width.
              */}
              <div className="relative mt-2 overflow-visible" style={{ height: CHART_H }}>
                <svg
                  viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                  className="absolute inset-0 h-full w-full"
                  style={{ overflow: "visible" }}
                >
                  <defs>
                    <linearGradient id="scoreFillV2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgb(99 102 241)" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="rgb(99 102 241)" stopOpacity={0} />
                    </linearGradient>
                  </defs>

                  {/* Grid lines */}
                  {Y_TICKS.map((t) => {
                    const y = yScore(t);
                    return (
                      <g key={t}>
                        <line
                          x1={PAD_X}
                          x2={CHART_W - 8}
                          y1={y}
                          y2={y}
                          stroke="rgb(244 244 245)"
                          strokeWidth={1}
                        />
                        <text
                          x={PAD_X - 6}
                          y={y + 3.5}
                          textAnchor="end"
                          fill="rgb(161 161 170)"
                          style={{ fontSize: 9 }}
                        >
                          {t}
                        </text>
                      </g>
                    );
                  })}

                  {/* Vertical crosshair */}
                  {activeI != null && coords[activeI] && (
                    <line
                      x1={xAt(activeI)}
                      x2={xAt(activeI)}
                      y1={PAD_Y}
                      y2={CHART_H - PAD_Y}
                      stroke="rgb(199 210 254)"
                      strokeWidth={1}
                      strokeDasharray="3 3"
                    />
                  )}

                  {/* Area fill */}
                  {area && <polygon points={area} fill="url(#scoreFillV2)" />}

                  {/* Score line */}
                  {line && (
                    <polyline
                      points={line}
                      fill="none"
                      stroke="rgb(79 70 229)"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Hit areas + data points */}
                  {points.map((p, i) => {
                    const c = coords[i];
                    const isHovered = hover === i;
                    const isSelected = selected === i;
                    const isActive = isHovered || isSelected;
                    return (
                      <g key={p.scanRunId}>
                        <rect
                          x={xAt(i) - innerW / Math.max(1, points.length) / 2}
                          y={0}
                          width={innerW / Math.max(1, points.length)}
                          height={CHART_H}
                          fill="transparent"
                          className="cursor-pointer"
                          onMouseEnter={() => setHover(i)}
                          onMouseLeave={() => setHover(null)}
                          onClick={() => handlePointClick(i)}
                        />
                        {c && (
                          <circle
                            cx={c.x}
                            cy={c.y}
                            r={isActive ? 6 : 4}
                            fill={isSelected ? "rgb(79 70 229)" : "white"}
                            stroke="rgb(79 70 229)"
                            strokeWidth={isActive ? 2.5 : 2}
                            style={{ pointerEvents: "none" }}
                          />
                        )}
                      </g>
                    );
                  })}
                </svg>

                {/* Hover tooltip — anchored inside the SVG container div so percentages are correct */}
                {hover != null && points[hover] && coords[hover] && hover !== selected && (
                  <div
                    className="pointer-events-none absolute z-20 rounded-lg border border-zinc-200/90 bg-white px-3 py-2 text-xs shadow-lg shadow-zinc-950/10"
                    style={{
                      left: `${(coords[hover]!.x / CHART_W) * 100}%`,
                      bottom: `${(1 - coords[hover]!.y / CHART_H) * 100}%`,
                      transform: "translateX(-50%) translateY(-8px)",
                    }}
                  >
                    <p className="font-semibold text-zinc-900">{fmtDay(points[hover].date)}</p>
                    <p className="mt-1 tabular-nums text-zinc-700">
                      <span className="font-bold text-indigo-700">{points[hover].score ?? "—"}%</span> score
                    </p>
                    <p className="mt-0.5 tabular-nums text-zinc-700">
                      <span className="font-bold text-rose-600">{points[hover].failing}</span> failing
                    </p>
                    {points[hover].findingsOpened > 0 && (
                      <p className="mt-0.5 text-zinc-500">
                        +{points[hover].findingsOpened} findings opened
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Date axis */}
              <div className="mt-1 flex justify-between pl-9 pr-1 text-[11px] font-medium tabular-nums text-zinc-400">
                <span>{fmtDay(points[0].date)}</span>
                {points.length > 1 && <span>{fmtDay(points[points.length - 1].date)}</span>}
              </div>

              <div className="mt-2 flex items-center gap-4 pl-9 text-[10px] text-zinc-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-indigo-600" aria-hidden />
                  Score %
                </span>
                <span className="text-zinc-300">·</span>
                <span>Click point for details</span>
              </div>

              {/* Selected point inline detail */}
              {selected != null && points[selected] && (
                <PointDetailPanel
                  point={points[selected]}
                  onViewEvidence={(id) => onSelectSnapshot?.(id)}
                />
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">Run more scans to see posture trend.</p>
          )}
        </div>
      </div>
    </section>
  );
}
