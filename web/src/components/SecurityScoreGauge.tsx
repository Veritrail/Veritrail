import { useEffect, useId, useState } from "react";
import "../styles/security-score-gauge.css";

export type SecurityScoreGaugeTone = "critical" | "poor" | "fair" | "good";

export function SecurityScoreGauge({
  score,
  tone,
  hubDisplay,
  hubKind = "numeric",
  sublabel,
  size = 76,
}: {
  score: number;
  tone: SecurityScoreGaugeTone;
  hubDisplay: string;
  hubKind?: "numeric" | "label";
  sublabel?: string;
  size?: number;
}) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circum = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * circum;
  const gradientPrefix = useId().replace(/:/g, "");
  const gradientId = `${gradientPrefix}-security-score-arc-${tone}`;
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    setFilled(false);
    const frame = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(frame);
  }, [score]);

  return (
    <div className="security-score-gauge" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="security-score-gauge__svg" aria-hidden>
        <defs>
          <linearGradient id={`${gradientPrefix}-security-score-arc-good`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6ee7b7" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
          <linearGradient id={`${gradientPrefix}-security-score-arc-fair`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fcd34d" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
          <linearGradient id={`${gradientPrefix}-security-score-arc-poor`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fdba74" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
          <linearGradient id={`${gradientPrefix}-security-score-arc-critical`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fca5a5" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        <circle
          className="security-score-gauge__track"
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="security-score-gauge__arc"
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          strokeDasharray={`${filled ? dash : 0} ${circum}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </svg>
      <div className={`security-score-gauge__hub${sublabel ? " security-score-gauge__hub--stacked" : ""}`}>
        <span
          className={`security-score-gauge__score${hubKind === "label" ? " security-score-gauge__score--label" : ""}`}
        >
          {hubDisplay}
        </span>
        {sublabel ? <span className="security-score-gauge__sublabel">{sublabel}</span> : null}
      </div>
    </div>
  );
}
