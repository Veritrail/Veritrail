export type ImpactTone = "safe" | "caution" | "danger";

export type ImpactAnalysisDataSlice = {
  resource_type: string;
  confidence?: "high" | "medium" | "low";
  active_service_count?: number;
};

export type ImpactVerdict = { text: string; type: "safe" | "caution" | "warning" };

const BLOCKING_PHRASES = [
  "do not remove",
  "do not scope",
  "do not delete",
  "high blast radius",
  "will immediately break",
  "remove public access immediately",
  "make private immediately",
  "urgent",
  "downtime",
  "will break",
  "blocking",
];

export function isShortResourceLabel(name: string): boolean {
  const t = name.trim();
  if (!t) return true;
  if (t.length <= 48) return true;
  if (!t.includes(":") && t.length <= 64) return true;
  return false;
}

export function impactVisualTone(verdict: ImpactVerdict): ImpactTone {
  if (verdict.type === "safe") return "safe";
  const lower = verdict.text.toLowerCase();
  if (verdict.type === "warning" && BLOCKING_PHRASES.some((p) => lower.includes(p))) {
    return "danger";
  }
  return "caution";
}

export function impactConfidencePill(
  confidence: "high" | "medium" | "low",
  tone: ImpactTone,
): string {
  if (tone === "safe") return "Safe";
  if (confidence === "low") return "High impact";
  if (confidence === "medium") return "Review first";
  return "Proceed with caution";
}

export function impactVerdictCopy(
  verdict: ImpactVerdict,
  data: ImpactAnalysisDataSlice,
  _checkId?: string,
): { title: string; subtitle: string; detail?: string } {
  const tone = impactVisualTone(verdict);

  if (data.resource_type === "iam_root" && tone === "safe") {
    return {
      title: "Safe to remediate",
      subtitle: "No application workloads affected — only the root account identity.",
    };
  }

  if (tone === "safe") {
    const first = verdict.text.split(/(?<=[.!])\s+/)[0]?.trim() ?? verdict.text;
    const rest = verdict.text.slice(first.length).trim();
    return {
      title: "Safe to remediate",
      subtitle: first.endsWith(".") ? first : `${first}.`,
      detail: rest || undefined,
    };
  }

  if (data.resource_type === "iam_role") {
    const recent = data.active_service_count ?? 0;
    if (recent > 0 && tone !== "safe") {
      const svc = recent === 1 ? "service was" : "services were";
      const line = `${recent} ${svc} used in the last 30 days. Review usage before reducing permissions.`;
      return {
        title: "Active usage found",
        subtitle: line,
        detail: verdict.text !== line ? verdict.text : undefined,
      };
    }
  }

  if (tone === "danger") {
    return {
      title: "Blocking impact detected",
      subtitle: verdict.text,
    };
  }

  return {
    title: "Proceed with caution",
    subtitle: verdict.text,
  };
}
