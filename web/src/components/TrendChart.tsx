/** Pure SVG trend line chart — no library dependencies. */

interface TrendPoint {
  date: string;
  value: number | null;
}

export function TrendLineChart({ data, height = 80 }: { data: TrendPoint[]; height?: number }) {
  if (!data || data.length === 0) return null;

  const valid = data.filter(d => d.value !== null) as { date: string; value: number }[];
  if (valid.length < 2) return null;

  const w = 320;
  const h = height;
  const pad = { top: 8, right: 10, bottom: 18, left: 4 };
  const drawW = w - pad.left - pad.right;
  const drawH = h - pad.top - pad.bottom;

  const minVal = Math.min(...valid.map(d => d.value));
  const maxVal = Math.max(...valid.map(d => d.value));
  const range = maxVal - minVal || 1;

  const points = valid.map((d, i) => {
    const x = pad.left + (i / (valid.length - 1)) * drawW;
    const y = pad.top + drawH - ((d.value - minVal) / range) * drawH;
    return `${x},${y}`;
  });

  const areaPoints = [
    `${pad.left},${pad.top + drawH}`,
    ...points,
    `${pad.left + drawW},${pad.top + drawH}`,
  ];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="trendGradShared" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints.join(" ")} fill="url(#trendGradShared)" />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="#10b981"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface BarData {
  label: string;
  value: number;
  color?: string;
}

export function HorizontalBarChart({
  data,
  maxValue,
}: {
  data: BarData[];
  maxValue: number;
}) {
  const barH = 14;
  const gap = 4;
  const h = barH * data.length + gap * (data.length - 1) + 8;
  const chartW = 200;

  return (
    <svg viewBox={`0 0 290 ${h}`} className="w-full" style={{ maxHeight: Math.max(h, 60) }}>
      {data.map((d, i) => {
        const y = i * (barH + gap) + 4;
        const w = maxValue > 0 ? Math.max(2, (d.value / maxValue) * chartW) : 0;
        const c = d.color || "#9ca3af";
        return (
          <g key={i}>
            <rect x={0} y={y} width={chartW + 2} height={barH} rx={3} fill="#f4f4f5" />
            <rect x={0} y={y} width={w} height={barH} rx={3} fill={c} />
            <text x={chartW + 8} y={y + 11} className="fill-zinc-500" fontSize={11} fontFamily="system-ui, sans-serif">
              {d.label}
            </text>
            <text x={chartW + 65} y={y + 11} className="fill-zinc-900" fontSize={11} fontFamily="system-ui, sans-serif" fontWeight={600}>
              {d.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
