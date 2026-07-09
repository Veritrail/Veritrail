import type { SecurityScoreGaugeTone } from "../components/SecurityScoreGauge";

export type FindingSeverityStats = {
  critHigh: number;
  medium: number;
  low: number;
  open: number;
};

/** Qualitative grade for hero copy and score ring — Poor / Fair / Good only. */
export function postureGradeLabel(score: number): "Good" | "Fair" | "Poor" {
  if (score >= 80) return "Good";
  if (score >= 60) return "Fair";
  return "Poor";
}

export function postureGradeTone(score: number): SecurityScoreGaugeTone {
  if (score >= 80) return "good";
  if (score >= 60) return "fair";
  if (score >= 40) return "poor";
  return "critical";
}

export function topSeverityBucket(stats: FindingSeverityStats): {
  label: "high" | "medium" | "low";
  count: number;
} | null {
  if (stats.critHigh > 0) return { label: "high", count: stats.critHigh };
  if (stats.medium > 0) return { label: "medium", count: stats.medium };
  if (stats.low > 0) return { label: "low", count: stats.low };
  return null;
}

export function postureHeadline(stats: FindingSeverityStats, grade: string): string {
  if (stats.open === 0) return "No open findings — posture is clean.";
  const top = topSeverityBucket(stats);
  if (!top) return "No open findings — posture is clean.";
  const severityWord = top.label === "high" ? "high" : top.label;
  return `${grade} posture driven by ${top.count.toLocaleString()} ${severityWord} finding${top.count === 1 ? "" : "s"}.`;
}

export function postureGuidance(stats: FindingSeverityStats): string {
  if (stats.open === 0) {
    return "Keep monitoring with regular scans to maintain a clean posture.";
  }
  if (stats.critHigh > 0) {
    return "High-severity issues pose the greatest risk — prioritize remediation on those findings first.";
  }
  if (stats.medium > 0) {
    return "Medium-severity findings add up — address them before they compound into higher-risk gaps.";
  }
  return "Low-severity findings are a good next focus once higher-risk items are cleared.";
}

export type RecommendedAction = {
  id: string;
  label: string;
  detail: string;
};

export function buildRecommendedActions(stats: FindingSeverityStats): RecommendedAction[] {
  const actions: RecommendedAction[] = [];
  if (stats.critHigh > 0) {
    actions.push({
      id: "high-findings",
      label: "Remediate high-severity findings",
      detail: `${stats.critHigh.toLocaleString()} open high finding${stats.critHigh === 1 ? "" : "s"} need attention.`,
    });
  }
  if (stats.open > 0) {
    actions.push({
      id: "iam",
      label: "Address IAM policy risks",
      detail: "Review overly permissive roles and stale access keys.",
    });
    actions.push({
      id: "exposure",
      label: "Resolve public exposure",
      detail: "Close unintended public access on storage and network resources.",
    });
    actions.push({
      id: "encryption",
      label: "Enforce encryption",
      detail: "Enable encryption at rest and in transit where gaps remain.",
    });
  }
  return actions.slice(0, 4);
}
