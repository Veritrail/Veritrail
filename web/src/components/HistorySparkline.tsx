import type { PostureTrendPoint } from "../lib/complianceHistory";

const SPARK_W = 640;
const SPARK_H = 72;
const PAD_X = 14;
const PAD_TOP = 12;
const PAD_BOTTOM = 10;
const STROKE = "#3b82f6";
const GRAD_ID = "history-spark-fill";
const LINE_GRAD_ID = "history-spark-line";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type Pt = { x: number; y: number };

/**
 * Y ceiling for the posture area. Floored at 0 (0% = empty, the honest read)
 * with rounded headroom above the peak — so a low posture sits genuinely low
 * and a high one fills the cell, without min-span amplification that turned a
 * 1pt wobble into a cliff.
 */
function domainHigh(scores: number[]): number {
  const max = Math.max(...scores);
  return clamp(Math.ceil((max + 12) / 10) * 10, 40, 100);
}

function buildCoords(points: PostureTrendPoint[]): { coords: Pt[]; baseY: number } {
  const sorted = [...points].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const scores = sorted.map((p) => clamp(p.posture_score, 0, 100));
  const high = domainHigh(scores);
  const plotW = SPARK_W - PAD_X * 2;
  const plotH = SPARK_H - PAD_TOP - PAD_BOTTOM;
  const baseY = SPARK_H - PAD_BOTTOM;
  const yFor = (s: number) => baseY - (clamp(s, 0, high) / high) * plotH;

  // 0% across the whole window: a line on the literal floor reads as a broken
  // floating dot. Lift it to a clean, visible baseline with a thin fill — still
  // unmistakably flat-and-low, just intentional.
  if (scores.every((s) => s <= 0)) {
    const y = baseY - plotH * 0.16;
    return { coords: [{ x: PAD_X, y }, { x: SPARK_W - PAD_X, y }], baseY };
  }

  if (scores.length === 1) {
    const y = yFor(scores[0]);
    return { coords: [{ x: PAD_X, y }, { x: SPARK_W - PAD_X, y }], baseY };
  }

  const coords = sorted.map((p, i) => ({
    x: PAD_X + (i / (sorted.length - 1)) * plotW,
    y: yFor(scores[i]),
  }));
  return { coords, baseY };
}

/**
 * Monotone cubic (Fritsch–Carlson) smoothing — a flowing curve through the
 * points with no overshoot, so the line never dips below the data or bulges
 * past 0/100. Returns the SVG path command string after the initial moveTo.
 */
function smoothPath(pts: Pt[]): string {
  const n = pts.length;
  if (n < 2) return "";
  if (n === 2) return `L ${pts[1].x.toFixed(2)},${pts[1].y.toFixed(2)}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const h = pts[i + 1].x - pts[i].x;
    dx.push(h);
    slope.push((pts[i + 1].y - pts[i].y) / h);
  }

  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0;
    } else {
      m[i] = (slope[i - 1] + slope[i]) / 2;
    }
  }
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / slope[i];
      const b = m[i + 1] / slope[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * slope[i];
        m[i + 1] = t * b * slope[i];
      }
    }
  }

  let d = "";
  for (let i = 0; i < n - 1; i += 1) {
    const c1x = pts[i].x + dx[i] / 3;
    const c1y = pts[i].y + (m[i] * dx[i]) / 3;
    const c2x = pts[i + 1].x - dx[i] / 3;
    const c2y = pts[i + 1].y - (m[i + 1] * dx[i]) / 3;
    d += ` C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`;
  }
  return d.trim();
}

function EmptySparkline({ className }: { className: string }) {
  return (
    <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} className={className} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <line
        x1={PAD_X}
        y1={SPARK_H / 2}
        x2={SPARK_W - PAD_X}
        y2={SPARK_H / 2}
        stroke="#d1d5db"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="5 10"
      />
    </svg>
  );
}

export function HistorySparkline({
  points,
  className = "history-stats__spark",
}: {
  points: PostureTrendPoint[];
  className?: string;
}) {
  if (points.length === 0) {
    return <EmptySparkline className={className} />;
  }

  const { coords, baseY } = buildCoords(points);
  const start = coords[0];
  const end = coords[coords.length - 1];
  const curve = smoothPath(coords);
  const linePath = `M ${start.x.toFixed(2)},${start.y.toFixed(2)} ${curve}`;
  const areaPath = `${linePath} L ${end.x.toFixed(2)},${baseY} L ${start.x.toFixed(2)},${baseY} Z`;

  return (
    <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} className={className} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <defs>
        <linearGradient id={GRAD_ID} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={STROKE} stopOpacity="0.22" />
          <stop offset="55%" stopColor={STROKE} stopOpacity="0.07" />
          <stop offset="100%" stopColor={STROKE} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={LINE_GRAD_ID} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${GRAD_ID})`} />
      <path
        d={linePath}
        fill="none"
        stroke={`url(#${LINE_GRAD_ID})`}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={end.x} cy={end.y} r={7} fill={STROKE} fillOpacity={0.14} />
      <circle cx={end.x} cy={end.y} r={3.5} fill="#fff" stroke={STROKE} strokeWidth={2.25} />
    </svg>
  );
}
