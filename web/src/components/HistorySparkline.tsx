import type { PostureTrendPoint } from "../lib/complianceHistory";

const SPARK_W = 200;
const SPARK_H = 56;
const SPARK_PAD_X = 10;
const SPARK_PAD_Y = 10;
const SPARK_STROKE = "#3b82f6";
const SPARK_FRAME = "#e5e7eb";

function densifyTrend(points: PostureTrendPoint[], samples: number): PostureTrendPoint[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (sorted.length === 1) {
    return Array.from({ length: samples }, (_, i) => ({
      timestamp: new Date(new Date(sorted[0].timestamp).getTime() + i).toISOString(),
      posture_score: sorted[0].posture_score,
    }));
  }

  const t0 = new Date(sorted[0].timestamp).getTime();
  const t1 = new Date(sorted[sorted.length - 1].timestamp).getTime();
  const span = Math.max(t1 - t0, 1);

  return Array.from({ length: samples }, (_, i) => {
    const t = t0 + (i / (samples - 1)) * span;
    let j = 0;
    while (j < sorted.length - 1 && new Date(sorted[j + 1].timestamp).getTime() < t) j += 1;
    const a = sorted[j];
    const b = sorted[Math.min(j + 1, sorted.length - 1)];
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    const frac = tb === ta ? 0 : (t - ta) / (tb - ta);
    return {
      timestamp: new Date(t).toISOString(),
      posture_score: a.posture_score + frac * (b.posture_score - a.posture_score),
    };
  });
}

function smoothSparkPath(coords: { x: number; y: number }[]): string {
  if (coords.length < 2) return "";
  if (coords.length === 2) {
    return `M ${coords[0].x},${coords[0].y} L ${coords[1].x},${coords[1].y}`;
  }

  let d = `M ${coords[0].x},${coords[0].y}`;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p0 = coords[Math.max(0, i - 1)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(coords.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

function sparkFrame() {
  const baseY = SPARK_H - SPARK_PAD_Y;
  return (
    <>
      <line x1={SPARK_PAD_X} y1={baseY} x2={SPARK_W - SPARK_PAD_X} y2={baseY} stroke={SPARK_FRAME} strokeWidth={1} />
      <line x1={SPARK_PAD_X} y1={SPARK_PAD_Y} x2={SPARK_PAD_X} y2={baseY} stroke={SPARK_FRAME} strokeWidth={1} />
      <line x1={SPARK_W - SPARK_PAD_X} y1={SPARK_PAD_Y} x2={SPARK_W - SPARK_PAD_X} y2={baseY} stroke={SPARK_FRAME} strokeWidth={1} />
    </>
  );
}

export function HistorySparkline({
  points,
  className = "history-stats__spark",
}: {
  points: PostureTrendPoint[];
  className?: string;
}) {
  const viewBox = `0 0 ${SPARK_W} ${SPARK_H}`;

  if (points.length === 0) {
    return (
      <svg viewBox={viewBox} className={className} preserveAspectRatio="xMidYMid meet" aria-hidden>
        {sparkFrame()}
        <line
          x1={SPARK_PAD_X}
          y1={SPARK_H / 2}
          x2={SPARK_W - SPARK_PAD_X}
          y2={SPARK_H / 2}
          stroke="#d1d5db"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
      </svg>
    );
  }

  const dense = densifyTrend(points, 32);
  const scores = dense.map((p) => p.posture_score);
  const rawMin = Math.min(...scores);
  const rawMax = Math.max(...scores);
  const padRange = rawMin === rawMax ? 12 : 0;
  const low = Math.max(0, rawMin - padRange);
  const high = Math.min(100, rawMax + padRange);
  const span = Math.max(high - low, 1);
  const plotH = SPARK_H - SPARK_PAD_Y * 2;

  const coords = dense.map((p, i) => ({
    x: SPARK_PAD_X + (i / (dense.length - 1)) * (SPARK_W - SPARK_PAD_X * 2),
    y: SPARK_H - SPARK_PAD_Y - ((p.posture_score - low) / span) * plotH,
  }));

  const path = smoothSparkPath(coords);
  const start = coords[0];
  const end = coords[coords.length - 1];

  return (
    <svg viewBox={viewBox} className={className} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {sparkFrame()}
      <path d={path} fill="none" stroke={SPARK_STROKE} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={start.x} cy={start.y} r={3.5} fill={SPARK_STROKE} />
      <circle cx={end.x} cy={end.y} r={3.5} fill={SPARK_STROKE} />
    </svg>
  );
}
