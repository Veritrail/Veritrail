import type { HistoryEvent } from "../lib/complianceHistory";
import { postureSeries } from "../lib/historyEvidence";

function Sparkline({ events, positive }: { events: HistoryEvent[]; positive: boolean }) {
  const pts = postureSeries(events);
  const w = 280;
  const h = 60;
  const pad = 5;
  const stroke = positive ? "#10b981" : "#f43f5e";
  const fillId = positive ? "spark-up" : "spark-down";

  if (pts.length < 2) {
    const y = h / 2;
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full" preserveAspectRatio="none" aria-hidden>
        <line x1={pad} y1={y} x2={w - pad} y2={y} stroke="#d4d4d8" strokeWidth={2} strokeDasharray="4 4" />
      </svg>
    );
  }

  const xs = pts.map((_, i) => pad + (i / (pts.length - 1)) * (w - 2 * pad));
  const ys = pts.map((p) => h - pad - (Math.max(0, Math.min(100, p.posture)) / 100) * (h - 2 * pad));
  const line = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
  const area = `M ${xs[0]},${h - pad} ` + xs.map((x, i) => `L ${x},${ys[i]}`).join(" ") + ` L ${xs[xs.length - 1]},${h - pad} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${fillId})`} />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={3} fill={stroke} />
    </svg>
  );
}

function Chip({ label, value, tone }: { label: string; value: number | string; tone: "emerald" | "rose" | "indigo" | "amber" | "zinc" }) {
  const cls = {
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-100",
    rose: "bg-rose-50 text-rose-800 ring-rose-100",
    indigo: "bg-indigo-50 text-indigo-800 ring-indigo-100",
    amber: "bg-amber-50 text-amber-900 ring-amber-100",
    zinc: "bg-zinc-50 text-zinc-700 ring-zinc-200/80",
  }[tone];
  return (
    <div className={`rounded-2xl px-4 py-2.5 ring-1 ${cls}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-70">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-950">{value}</p>
    </div>
  );
}

export function PostureTrend({
  events,
  currentScore,
  days,
  verified,
  improved,
  regressed,
  open,
  scans,
}: {
  events: HistoryEvent[];
  currentScore: number | null | undefined;
  days: number;
  verified: number;
  improved: number;
  regressed: number;
  open: number;
  scans: number;
}) {
  const series = postureSeries(events);
  const start = series[0]?.posture ?? null;
  const score = currentScore ?? series[series.length - 1]?.posture ?? null;
  const delta = start != null && score != null ? score - start : null;
  const positive = (delta ?? 0) >= 0;

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-sm shadow-zinc-950/[0.02]">
      <div className="h-1 bg-gradient-to-r from-emerald-400 via-indigo-500 to-rose-400" />
      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:items-center">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Posture over time</p>
          <div className="mt-1 flex items-end gap-3">
            <span className="text-4xl font-semibold tabular-nums tracking-tight text-zinc-950">
              {score != null ? `${score}%` : "—"}
            </span>
            {delta != null && delta !== 0 && (
              <span
                className={`mb-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                  positive ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" : "bg-rose-50 text-rose-700 ring-1 ring-rose-100"
                }`}
              >
                {positive ? "▲" : "▼"} {Math.abs(delta)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">Mapped-control pass rate · last {days}d</p>
          <div className="mt-2">
            <Sparkline events={events} positive={positive} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Chip label="Verified" value={verified} tone="emerald" />
          <Chip label="Improved" value={improved} tone="emerald" />
          <Chip label="Regressed" value={regressed} tone={regressed > 0 ? "rose" : "zinc"} />
          <Chip label="Open" value={open || "—"} tone={open > 0 ? "amber" : "zinc"} />
          <Chip label="Scans" value={scans} tone="indigo" />
        </div>
      </div>
    </section>
  );
}
