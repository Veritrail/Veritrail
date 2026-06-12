import type { PostureTrendPoint } from "../lib/complianceHistory";

const SPARK_W = 360;
const SPARK_H = 72;
const SPARK_PAD_X = 16;
const SPARK_PAD_Y = 12;
const SPARK_STROKE = "#3b82f6";
const SPARK_FRAME = "#e5e7eb";
const SPARK_FILL_ID = "history-spark-fill";

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
      <line x1={SPARK_PAD_X} y1={SPARK_H / 2} x2={SPARK_W - SPARK_PAD_X} y2={SPARK_H / 2} stroke="#eef2ff" strokeWidth={1} strokeDasharray="3 7" />
      <line x1={SPARK_PAD_X} y1={SPARK_PAD_Y} x2={SPARK_PAD_X} y2={baseY} stroke={SPARK_FRAME} strokeWidth={1} />
      <line x1={SPARK_W - SPARK_PAD_X} y1={SPARK_PAD_Y} x2={SPARK_W - SPARK_PAD_X} y2={baseY} stroke={SPARK_FRAME} strokeWidth={1} />
    </>
  );
}

function ZeroPostureAnimation({ className }: { className: string }) {
  const viewBox = `0 0 ${SPARK_W} ${SPARK_H}`;
  const baseY = SPARK_H - SPARK_PAD_Y;
  const points = [0.18, 0.34, 0.5, 0.66, 0.82].map((ratio) => ({
    x: SPARK_PAD_X + ratio * (SPARK_W - SPARK_PAD_X * 2),
    delay: ratio * 1.2,
  }));

  return (
    <svg viewBox={viewBox} className={`${className} history-stats__spark--zero`} preserveAspectRatio="none" aria-label="Zero percent posture">
      {sparkFrame()}
      <defs>
        <linearGradient id="history-zero-scan" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#93c5fd" stopOpacity={0} />
          <stop offset="45%" stopColor="#3b82f6" stopOpacity={0.75} />
          <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path
        d={`M ${SPARK_PAD_X},${baseY} C ${SPARK_W * 0.28},${baseY - 18} ${SPARK_W * 0.42},${baseY + 4} ${SPARK_W * 0.58},${baseY - 10} S ${SPARK_W - SPARK_PAD_X * 1.8},${baseY - 8} ${SPARK_W - SPARK_PAD_X},${baseY - 20}`}
        fill="none"
        stroke="#dbeafe"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray="6 10"
      />
      <rect x={SPARK_PAD_X} y={SPARK_PAD_Y} width="52" height={SPARK_H - SPARK_PAD_Y * 2} rx="26" fill="url(#history-zero-scan)" opacity={0.7}>
        <animate attributeName="x" values={`${SPARK_PAD_X};${SPARK_W - SPARK_PAD_X - 52};${SPARK_PAD_X}`} dur="3.8s" repeatCount="indefinite" />
      </rect>
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={baseY - (i % 2 === 0 ? 7 : 16)} r={4.5} fill="#3b82f6" opacity={0.85}>
            <animate attributeName="opacity" values="0.35;1;0.35" dur="1.9s" begin={`${p.delay}s`} repeatCount="indefinite" />
          </circle>
          <circle cx={p.x} cy={baseY - (i % 2 === 0 ? 7 : 16)} r={4.5} fill="none" stroke="#60a5fa" strokeWidth={1.5} opacity={0.45}>
            <animate attributeName="r" values="4.5;13;4.5" dur="1.9s" begin={`${p.delay}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.45;0;0.45" dur="1.9s" begin={`${p.delay}s`} repeatCount="indefinite" />
          </circle>
        </g>
      ))}
    </svg>
  );
}

function FlatPostureBand({
  className,
  score,
}: {
  className: string;
  score: number;
}) {
  const viewBox = `0 0 ${SPARK_W} ${SPARK_H}`;
  const y = SPARK_H - SPARK_PAD_Y - (Math.max(0, Math.min(100, score)) / 100) * (SPARK_H - SPARK_PAD_Y * 2);
  const bandTop = Math.max(SPARK_PAD_Y, y - 10);
  const bandHeight = Math.min(SPARK_H - SPARK_PAD_Y - bandTop, 20);

  return (
    <svg viewBox={viewBox} className={`${className} history-stats__spark--flat`} preserveAspectRatio="none" aria-hidden>
      {sparkFrame()}
      <defs>
        <linearGradient id="history-flat-band" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#dbeafe" stopOpacity={0.25} />
          <stop offset="45%" stopColor="#60a5fa" stopOpacity={0.35} />
          <stop offset="100%" stopColor="#ccfbf1" stopOpacity={0.25} />
        </linearGradient>
        <linearGradient id="history-flat-sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0} />
          <stop offset="50%" stopColor="#3b82f6" stopOpacity={0.75} />
          <stop offset="100%" stopColor="#14b8a6" stopOpacity={0} />
        </linearGradient>
      </defs>
      <rect x={SPARK_PAD_X} y={bandTop} width={SPARK_W - SPARK_PAD_X * 2} height={bandHeight} rx={bandHeight / 2} fill="url(#history-flat-band)" />
      <line x1={SPARK_PAD_X} y1={y} x2={SPARK_W - SPARK_PAD_X} y2={y} stroke="#3b82f6" strokeWidth={4} strokeLinecap="round" />
      <rect x={SPARK_PAD_X} y={bandTop - 2} width="70" height={bandHeight + 4} rx={(bandHeight + 4) / 2} fill="url(#history-flat-sweep)" opacity={0.5}>
        <animate attributeName="x" values={`${SPARK_PAD_X};${SPARK_W - SPARK_PAD_X - 70};${SPARK_PAD_X}`} dur="4.2s" repeatCount="indefinite" />
      </rect>
      {[SPARK_PAD_X, SPARK_W * 0.5, SPARK_W - SPARK_PAD_X].map((x, i) => (
        <circle key={i} cx={x} cy={y} r={i === 1 ? 5 : 4.5} fill="#fff" stroke="#3b82f6" strokeWidth={2.5} />
      ))}
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
  const viewBox = `0 0 ${SPARK_W} ${SPARK_H}`;

  if (points.length === 0) {
    return (
      <svg viewBox={viewBox} className={className} preserveAspectRatio="none" aria-hidden>
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
  const hasOnlyZeroScores = scores.every((score) => score <= 0);

  if (hasOnlyZeroScores) {
    return <ZeroPostureAnimation className={className} />;
  }

  const rawMin = Math.min(...scores);
  const rawMax = Math.max(...scores);

  if (rawMin === rawMax) {
    return <FlatPostureBand className={className} score={rawMax} />;
  }

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
  const areaPath = `M ${coords[0].x},${SPARK_H - SPARK_PAD_Y} L ${coords.map((c) => `${c.x},${c.y}`).join(" L ")} L ${coords[coords.length - 1].x},${SPARK_H - SPARK_PAD_Y} Z`;
  const start = coords[0];
  const end = coords[coords.length - 1];

  return (
    <svg viewBox={viewBox} className={className} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={SPARK_FILL_ID} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={SPARK_STROKE} stopOpacity={0.2} />
          <stop offset="100%" stopColor={SPARK_STROKE} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      {sparkFrame()}
      <path d={areaPath} fill={`url(#${SPARK_FILL_ID})`} />
      <path d={path} fill="none" stroke={SPARK_STROKE} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={start.x} cy={start.y} r={4} fill="#fff" stroke={SPARK_STROKE} strokeWidth={2.5} />
      <circle cx={end.x} cy={end.y} r={4.5} fill={SPARK_STROKE} />
    </svg>
  );
}
