import type { IntegrationBrandId } from "./integrationBrands";

export type CatalogEntry = {
  key: string;
  brand: IntegrationBrandId;
  name: string;
  description: string;
  /** Up to three short category labels shown on catalog cards. */
  tags: [string, string, string];
  href?: string;
  comingSoon?: boolean;
};

export type CatalogCategory = {
  id: string;
  title: string;
  blurb: string;
  entries: CatalogEntry[];
};

/** Integration catalog — cloud providers (AWS, GCP, Azure) are added via Accounts, not here. */
export const INTEGRATION_CATALOG: CatalogCategory[] = [
  {
    id: "source-control",
    title: "Source control & SDLC",
    blurb: "Branch protection, review evidence, and change history.",
    entries: [
      { key: "github", brand: "github", name: "GitHub", description: "Repository governance and CI/CD safeguards.", tags: ["SCM", "CI/CD", "Governance"], href: "/integrations/github" },
      { key: "gitlab", brand: "gitlab", name: "GitLab", description: "Protected branches, approvals, and pipelines.", tags: ["SCM", "CI/CD", "Governance"], href: "/integrations/gitlab" },
    ],
  },
  {
    id: "identity",
    title: "Identity providers",
    blurb: "Directory sync, MFA posture, and access-review evidence.",
    entries: [
      { key: "entra", brand: "entra", name: "Microsoft Entra ID", description: "Directory and MFA evidence", tags: ["Directory", "MFA", "Access"], href: "/integrations/entra" },
      { key: "google-workspace", brand: "google-workspace", name: "Google Workspace", description: "User activity and admin governance evidence.", tags: ["Directory", "Admin", "Governance"], href: "/integrations/google-workspace" },
      { key: "okta", brand: "okta", name: "Okta", description: "Identity directory sync and access reviews.", tags: ["Directory", "SSO", "Access"], href: "/integrations/okta" },
    ],
  },
  {
    id: "scanners",
    title: "Vulnerability scanners",
    blurb: "Bring scanner results into vulnerability-management evidence.",
    entries: [
      { key: "snyk", brand: "snyk", name: "Snyk", description: "Code and dependency scans", tags: ["SAST", "Dependencies", "Code"], href: "/integrations/scanners/snyk" },
      { key: "wiz", brand: "wiz", name: "Wiz", description: "Cloud vulnerability findings as evidence.", tags: ["CSPM", "CNAPP", "Findings"], href: "/integrations/scanners/wiz" },
      { key: "tenable", brand: "tenable", name: "Tenable", description: "Vulnerability management coverage evidence.", tags: ["VM", "Exposure", "Assets"], href: "/integrations/scanners/tenable" },
      { key: "qualys", brand: "qualys", name: "Qualys", description: "Scanner coverage and findings export.", tags: ["VM", "Vulnerability", "Assets"], href: "/integrations/scanners/qualys" },
      { key: "orca", brand: "orca", name: "Orca", description: "Agentless cloud scanning evidence.", tags: ["CSPM", "Misconfig", "Assets"], href: "/integrations/scanners/orca" },
      { key: "aikido", brand: "aikido", name: "Aikido", description: "AppSec findings as audit evidence.", tags: ["DAST", "SCA", "AppSec"], href: "/integrations/scanners/aikido" },
    ],
  },
  {
    id: "siem",
    title: "SIEM & monitoring",
    blurb: "Signal evidence that logging and alerting operate.",
    entries: [
      { key: "splunk", brand: "splunk", name: "Splunk", description: "SIEM signal evidence.", tags: ["SIEM", "Logs", "Alerts"], href: "/integrations/siem/splunk" },
      { key: "datadog", brand: "datadog", name: "Datadog", description: "Monitoring signal evidence.", tags: ["Monitoring", "Metrics", "Alerts"], href: "/integrations/siem/datadog" },
      { key: "elastic", brand: "elastic", name: "Elastic", description: "SIEM export adapter.", tags: ["SIEM", "Logs", "Alerts"], href: "/integrations/siem/elastic" },
    ],
  },
  {
    id: "ticketing",
    title: "Ticketing & remediation",
    blurb: "Turn findings into tracked remediation work.",
    entries: [
      { key: "jira", brand: "jira", name: "Jira", description: "Remediation tickets with sync", tags: ["Ticketing", "Workflow", "Issues"], href: "/integrations/jira" },
      { key: "iac-repository", brand: "iac", name: "IaC repository", description: "Terraform PRs from findings", tags: ["IaC", "Terraform", "GitOps"], href: "/integrations/iac-repository" },
      { key: "azure-devops", brand: "azure-devops", name: "Azure DevOps Pipelines", description: "Track work and pipelines.", tags: ["CI/CD", "Pipelines", "Boards"], comingSoon: true },
    ],
  },
  {
    id: "alerts",
    title: "Alerts & digests",
    blurb: "Route scan alerts and weekly digests to your team.",
    entries: [
      { key: "slack", brand: "slack", name: "Slack", description: "Scan alerts and weekly digests for your channel.", tags: ["Alerts", "Digests", "Channels"], href: "/integrations/slack" },
    ],
  },
];

export type ConnectedCatalogState = {
  awsConnected: boolean;
  githubConnected: boolean;
  gitlabConnected: boolean;
  googleConnected: boolean;
  entraConnected: boolean;
  oktaConnected: boolean;
  slackConnected: boolean;
  gcpConnected: boolean;
  azureConnected: boolean;
  iacRepositoryConnected: boolean;
  jiraConnected: boolean;
  splunkConnected: boolean;
  datadogConnected: boolean;
  connectedScanners: Partial<Record<"snyk" | "wiz" | "tenable" | "qualys" | "orca" | "aikido", boolean>>;
};

/** Catalog keys to hide because the workspace already has that connector active. */
export function connectedCatalogKeys(state: ConnectedCatalogState): ReadonlySet<string> {
  const hidden = new Set<string>();
  if (state.githubConnected) hidden.add("github");
  if (state.gitlabConnected) hidden.add("gitlab");
  if (state.googleConnected) hidden.add("google-workspace");
  if (state.entraConnected) hidden.add("entra");
  if (state.oktaConnected) hidden.add("okta");
  if (state.slackConnected) hidden.add("slack");
  if (state.iacRepositoryConnected) hidden.add("iac-repository");
  if (state.jiraConnected) hidden.add("jira");
  if (state.splunkConnected) hidden.add("splunk");
  if (state.datadogConnected) hidden.add("datadog");
  for (const [vendor, connected] of Object.entries(state.connectedScanners)) {
    if (connected) hidden.add(vendor);
  }
  return hidden;
}

export type CatalogStatusFilter = "all" | "available" | "connected" | "coming-soon";

export type CatalogSortKey = "name-asc" | "name-desc";

export type CatalogFilterOptions = {
  query?: string;
  statusFilter?: CatalogStatusFilter;
  categoryId?: string;
  sortKey?: CatalogSortKey;
};

export function catalogEntryStatus(
  entry: CatalogEntry,
  hiddenKeys: ReadonlySet<string>,
): "available" | "connected" | "coming-soon" {
  if (entry.comingSoon || !entry.href) return "coming-soon";
  if (hiddenKeys.has(entry.key)) return "connected";
  return "available";
}

function matchesCatalogStatus(
  entry: CatalogEntry,
  hiddenKeys: ReadonlySet<string>,
  statusFilter: CatalogStatusFilter,
): boolean {
  if (statusFilter === "all") return true;
  return catalogEntryStatus(entry, hiddenKeys) === statusFilter;
}

function sortCatalogEntries(entries: CatalogEntry[], sortKey: CatalogSortKey): CatalogEntry[] {
  const sorted = [...entries];
  sorted.sort((a, b) => {
    const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    return sortKey === "name-desc" ? -cmp : cmp;
  });
  return sorted;
}

export function filterCatalog(
  catalog: CatalogCategory[],
  hiddenKeys: ReadonlySet<string>,
  queryOrOptions: string | CatalogFilterOptions = "",
): CatalogCategory[] {
  const options: CatalogFilterOptions =
    typeof queryOrOptions === "string" ? { query: queryOrOptions } : queryOrOptions;
  const {
    query = "",
    statusFilter = "available",
    categoryId = "all",
    sortKey = "name-asc",
  } = options;
  const q = query.trim().toLowerCase();

  return catalog
    .filter((cat) => categoryId === "all" || cat.id === categoryId)
    .map((cat) => ({
      ...cat,
      entries: sortCatalogEntries(
        cat.entries.filter((entry) => {
          if (!matchesCatalogStatus(entry, hiddenKeys, statusFilter)) return false;
          if (!q) return true;
          return (
            entry.name.toLowerCase().includes(q) ||
            entry.description.toLowerCase().includes(q) ||
            entry.tags.some((tag) => tag.toLowerCase().includes(q))
          );
        }),
        sortKey,
      ),
    }))
    .filter((cat) => cat.entries.length > 0);
}

export function catalogSectionCountLabel(count: number, statusFilter: CatalogStatusFilter): string {
  if (count === 0) return "";
  let label: string;
  switch (statusFilter) {
    case "available":
      label = count === 1 ? "1 available" : `${count} available`;
      break;
    case "connected":
      label = count === 1 ? "1 connected" : `${count} connected`;
      break;
    case "coming-soon":
      label = count === 1 ? "1 coming soon" : `${count} coming soon`;
      break;
    default:
      label = count === 1 ? "1 integration" : `${count} integrations`;
  }
  return `[${label}]`;
}

export function catalogExploreEntries(
  catalog: CatalogCategory[],
  hiddenKeys: ReadonlySet<string>,
): CatalogEntry[] {
  return catalog.flatMap((cat) =>
    cat.entries.filter((entry) => !hiddenKeys.has(entry.key) && !entry.comingSoon && entry.href),
  );
}

export function catalogEntryCount(catalog: CatalogCategory[], hiddenKeys: ReadonlySet<string>): number {
  return catalog.reduce(
    (total, cat) => total + cat.entries.filter((entry) => !hiddenKeys.has(entry.key)).length,
    0,
  );
}

/** Tier 1: IaC repository, Jira, Slack — shown until all three are connected. */
export const RECOMMENDED_INTEGRATION_TIER_1 = ["iac-repository", "jira", "slack"] as const;

/** Tier 2: GitHub, GitLab — shown when tier 1 is fully connected. */
export const RECOMMENDED_INTEGRATION_TIER_2 = ["github", "gitlab"] as const;

/** Tier 3: Google Workspace — shown when tiers 1 and 2 are fully connected. */
export const RECOMMENDED_INTEGRATION_TIER_3 = ["google-workspace"] as const;

export type RecommendedIntegrationKey =
  | (typeof RECOMMENDED_INTEGRATION_TIER_1)[number]
  | (typeof RECOMMENDED_INTEGRATION_TIER_2)[number]
  | (typeof RECOMMENDED_INTEGRATION_TIER_3)[number];

export function catalogEntryByKey(key: string): CatalogEntry | undefined {
  for (const category of INTEGRATION_CATALOG) {
    const entry = category.entries.find((e) => e.key === key);
    if (entry) return entry;
  }
  return undefined;
}

function isRecommendableCatalogKey(key: string, hiddenKeys: ReadonlySet<string>): boolean {
  if (hiddenKeys.has(key)) return false;
  const entry = catalogEntryByKey(key);
  return !!entry?.href && !entry.comingSoon;
}

function unconnectedInTier(
  tier: readonly string[],
  hiddenKeys: ReadonlySet<string>,
): RecommendedIntegrationKey[] {
  return tier.filter((key) => isRecommendableCatalogKey(key, hiddenKeys)) as RecommendedIntegrationKey[];
}

function tierFullyConnected(tier: readonly string[], hiddenKeys: ReadonlySet<string>): boolean {
  return tier.every((key) => {
    const entry = catalogEntryByKey(key);
    if (!entry?.href || entry.comingSoon) return true;
    return hiddenKeys.has(key);
  });
}

/** Recommended integrations for the hub strip — tiered, no backfill beyond tier 3. */
export function getRecommendedIntegrationKeys(
  hiddenKeys: ReadonlySet<string>,
): RecommendedIntegrationKey[] {
  const tier1 = unconnectedInTier(RECOMMENDED_INTEGRATION_TIER_1, hiddenKeys);
  if (tier1.length > 0) return tier1;

  if (!tierFullyConnected(RECOMMENDED_INTEGRATION_TIER_1, hiddenKeys)) return [];

  const tier2 = unconnectedInTier(RECOMMENDED_INTEGRATION_TIER_2, hiddenKeys);
  if (tier2.length > 0) return tier2;

  if (!tierFullyConnected(RECOMMENDED_INTEGRATION_TIER_2, hiddenKeys)) return [];

  return unconnectedInTier(RECOMMENDED_INTEGRATION_TIER_3, hiddenKeys);
}
