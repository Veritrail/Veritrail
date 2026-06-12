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
      <line x1={SPARK_PAD_X} y1={y} x2={SPARK_W - SPARK_PAD_X} y2={y} stroke="#3b82f6" strokeWidth={3} strokeLinecap="round" />
      <rect x={SPARK_PAD_X} y={bandTop - 2} width="70" height={bandHeight + 4} rx={(bandHeight + 4) / 2} fill="url(#history-flat-sweep)" opacity={0.5}>
        <animate attributeName="x" values={`${SPARK_PAD_X};${SPARK_W - SPARK_PAD_X - 70};${SPARK_PAD_X}`} dur="4.2s" repeatCount="indefinite" />
      </rect>
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
    return <ZeroPostureAnimation className={className} />;
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
