import type { PostureTrendPoint } from "../lib/complianceHistory";

const SPARK_W = 720;
const SPARK_H = 72;
const SPARK_PAD_X = 22;
const SPARK_PAD_Y = 12;
const SPARK_STROKE = "#3b82f6";

function sparkFrame() {
  return null;
}

function trendDomain(scores: number[]) {
  const rawMin = Math.min(...scores);
  const rawMax = Math.max(...scores);
  if (rawMin === rawMax) return { low: Math.max(0, rawMin - 10), high: Math.min(100, rawMax + 10) };

  const minSpan = 24;
  if (rawMax - rawMin >= minSpan) return { low: Math.max(0, rawMin - 3), high: Math.min(100, rawMax + 3) };

  const center = (rawMin + rawMax) / 2;
  let low = center - minSpan / 2;
  let high = center + minSpan / 2;
  if (low < 0) {
    high -= low;
    low = 0;
  }
  if (high > 100) {
    low -= high - 100;
    high = 100;
  }
  return { low: Math.max(0, low), high: Math.min(100, high) };
}

function ZeroPostureState({ className }: { className: string }) {
  const viewBox = `0 0 ${SPARK_W} ${SPARK_H}`;
  const baseY = SPARK_H - SPARK_PAD_Y;
  const dotPoints = [0.18, 0.34, 0.5, 0.66, 0.82];

  return (
    <svg viewBox={viewBox} className={`${className} history-stats__spark--zero`} preserveAspectRatio="none" aria-label="Zero percent posture">
      {sparkFrame()}
      <polyline
        points={[
          `${SPARK_PAD_X},${baseY - 6}`,
          `${SPARK_W * 0.24},${baseY - 18}`,
          `${SPARK_W * 0.42},${baseY - 10}`,
          `${SPARK_W * 0.62},${baseY - 22}`,
          `${SPARK_W * 0.8},${baseY - 14}`,
          `${SPARK_W - SPARK_PAD_X},${baseY - 24}`,
        ].join(" ")}
        fill="none"
        stroke="#dbeafe"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="6 10"
      />
      {dotPoints.map((ratio, i) => (
        <circle
          key={i}
          cx={SPARK_PAD_X + ratio * (SPARK_W - SPARK_PAD_X * 2)}
          cy={baseY - (i % 2 === 0 ? 7 : 16)}
          r={3.5}
          fill="#bfdbfe"
          stroke="#60a5fa"
          strokeWidth={1.5}
          opacity={0.8}
        />
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
      </defs>
      <rect x={SPARK_PAD_X} y={bandTop} width={SPARK_W - SPARK_PAD_X * 2} height={bandHeight} rx={bandHeight / 2} fill="url(#history-flat-band)" />
      <line x1={SPARK_PAD_X} y1={y} x2={SPARK_W - SPARK_PAD_X} y2={y} stroke="#3b82f6" strokeWidth={3} strokeLinecap="round" />
      <circle cx={SPARK_W - SPARK_PAD_X} cy={y} r={3.5} fill={SPARK_STROKE} />
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
          strokeWidth={1.8}
          strokeDasharray="4 4"
        />
      </svg>
    );
  }

  const sorted = [...points].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const scores = sorted.map((p) => p.posture_score);
  const hasOnlyZeroScores = scores.every((score) => score <= 0);

  if (hasOnlyZeroScores) {
    return <ZeroPostureState className={className} />;
  }

  const rawMin = Math.min(...scores);
  const rawMax = Math.max(...scores);

  if (rawMin === rawMax) {
    return <FlatPostureBand className={className} score={rawMax} />;
  }

  const { low, high } = trendDomain(scores);
  const span = Math.max(high - low, 1);
  const plotH = SPARK_H - SPARK_PAD_Y * 2;

  const coords = sorted.map((p, i) => ({
    x: SPARK_PAD_X + (i / (sorted.length - 1)) * (SPARK_W - SPARK_PAD_X * 2),
    y: SPARK_H - SPARK_PAD_Y - ((p.posture_score - low) / span) * plotH,
  }));

  const line = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const end = coords[coords.length - 1];

  return (
    <svg viewBox={viewBox} className={className} preserveAspectRatio="none" aria-hidden>
      {sparkFrame()}
      <polyline points={line} fill="none" stroke={SPARK_STROKE} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={end.x} cy={end.y} r={3.75} fill={SPARK_STROKE} />
    </svg>
  );
}
