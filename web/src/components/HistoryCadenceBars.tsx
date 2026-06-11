const BAR_COUNT = 28;
const BAR_COLOR = "#4F86F7";

/** Activity sparkline: horizontal dashes when quiet, thin vertical bars when active. */
export function HistoryCadenceBars({
  values,
  className = "history-cadence-bars",
}: {
  values: number[];
  className?: string;
}) {
  const height = 20;
  const width = 100;
  const n = values.length;
  if (n === 0) return null;

  const max = Math.max(1, ...values);
  const gap = 1.1;
  const slotW = (width - gap * (n - 1)) / n;
  const trailingFrom = Math.floor(n * 0.72);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
      aria-hidden
    >
      {values.map((value, i) => {
        const fade = n <= 1 ? 1 : 1 - (i / (n - 1)) * 0.7;
        const x = i * (slotW + gap);
        const cx = x + slotW / 2;
        const baselineY = height - 3.5;

        if (value === 0) {
          const dashW = slotW * 0.62;
          const trailing = i >= trailingFrom;
          return (
            <line
              key={i}
              x1={cx - dashW / 2}
              x2={cx + dashW / 2}
              y1={baselineY}
              y2={baselineY}
              stroke={BAR_COLOR}
              strokeWidth={1.25}
              strokeLinecap="round"
              strokeDasharray={trailing ? "1.5 2" : undefined}
              opacity={trailing ? fade * 0.28 : fade * 0.38}
            />
          );
        }

        const barH = Math.max(5, (value / max) * (height - 4));
        const barW = Math.min(slotW * 0.42, 2.25);
        return (
          <rect
            key={i}
            x={cx - barW / 2}
            y={baselineY - barH}
            width={barW}
            height={barH}
            rx={barW / 2}
            fill={BAR_COLOR}
            opacity={fade}
          />
        );
      })}
    </svg>
  );
}

export function bucketActivitySeries(daily: number[], buckets = BAR_COUNT): number[] {
  if (daily.length <= buckets) return daily;
  const out = Array.from({ length: buckets }, () => 0);
  for (let i = 0; i < daily.length; i += 1) {
    const bucket = Math.min(buckets - 1, Math.floor((i / daily.length) * buckets));
    out[bucket] += daily[i];
  }
  return out;
}

export { BAR_COUNT };
