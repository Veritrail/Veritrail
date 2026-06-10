/** Helpers for What If / blast radius presentation */

export type BlastRadiusService = {
  name: string;
  last_used: string | null;
  days_ago: number | null;
  active: boolean;
  /** IAM returned per-action last access in the audit window */
  action_tracked?: boolean;
  /** Service last-used without action-level detail from IAM */
  service_only_signal?: boolean;
  in_policy: boolean;
};

export type ServiceUsageBuckets = {
  recentlyActive: BlastRadiusService[];
  historicallyUsed: BlastRadiusService[];
  likelySafe: BlastRadiusService[];
};

const RECENT_DAYS = 30;
const HISTORICAL_MAX_DAYS = 90;

export function bucketServicesByUsage(services: BlastRadiusService[]): ServiceUsageBuckets {
  const recentlyActive: BlastRadiusService[] = [];
  const historicallyUsed: BlastRadiusService[] = [];
  const likelySafe: BlastRadiusService[] = [];

  for (const s of services) {
    if (s.days_ago === null || s.days_ago > HISTORICAL_MAX_DAYS) {
      likelySafe.push(s);
    } else if (s.days_ago <= RECENT_DAYS) {
      recentlyActive.push(s);
    } else {
      historicallyUsed.push(s);
    }
  }

  const byDays = (a: BlastRadiusService, b: BlastRadiusService) =>
    (a.days_ago ?? 999) - (b.days_ago ?? 999);

  recentlyActive.sort(byDays);
  historicallyUsed.sort(byDays);
  likelySafe.sort((a, b) => a.name.localeCompare(b.name));

  return { recentlyActive, historicallyUsed, likelySafe };
}

export function formatServiceLastUsed(daysAgo: number | null): string {
  if (daysAgo === null) return "No recorded use";
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo < 30) return `${daysAgo} days ago`;
  if (daysAgo < 365) return `${Math.floor(daysAgo / 30)} mo ago`;
  return `${Math.floor(daysAgo / 365)} yr ago`;
}

export type ServiceActivityDecision = "keep" | "verify" | "remove";

export function serviceActivityDecision(service: BlastRadiusService): ServiceActivityDecision {
  if (service.days_ago === null || service.days_ago > HISTORICAL_MAX_DAYS) return "remove";
  if (service.days_ago <= RECENT_DAYS) return "keep";
  return "verify";
}

/** Services worth reviewing before remediation — excludes 90+ day / no-activity cleanup candidates. */
export function servicesForDependencyReview(services: BlastRadiusService[]): BlastRadiusService[] {
  return services.filter((s) => serviceActivityDecision(s) !== "remove");
}

export function serviceUsageActivityLabel(decision: ServiceActivityDecision): {
  title: string;
  sub: string;
  tone: "active" | "inactive" | "none";
} {
  if (decision === "keep") {
    return { title: "Active", sub: "Used in the last 30 days", tone: "active" };
  }
  if (decision === "verify") {
    return { title: "Inactive", sub: "Used 31–90 days ago", tone: "inactive" };
  }
  return { title: "No activity", sub: "90+ days", tone: "none" };
}
