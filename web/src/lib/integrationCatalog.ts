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
      { key: "github", brand: "github", name: "GitHub", description: "Repo governance and CI/CD.", tags: ["SCM", "CI/CD", "Governance"], href: "/integrations/github" },
      { key: "gitlab", brand: "gitlab", name: "GitLab", description: "Branch rules and approvals.", tags: ["SCM", "CI/CD", "Governance"], href: "/integrations/gitlab" },
    ],
  },
  {
    id: "identity",
    title: "Identity providers",
    blurb: "Directory sync, MFA posture, and access-review evidence.",
    entries: [
      { key: "entra", brand: "entra", name: "Microsoft Entra ID", description: "Directory and MFA evidence.", tags: ["Directory", "MFA", "Access"], href: "/integrations/entra" },
      { key: "google-workspace", brand: "google-workspace", name: "Google Workspace", description: "User and admin governance.", tags: ["Directory", "Admin", "Governance"], href: "/integrations/google-workspace" },
    ],
  },
  {
    id: "evidence-destinations",
    title: "Evidence destinations",
    blurb: "Push Veritrail evidence into your GRC platform (coming soon).",
    entries: [
      { key: "vanta", brand: "vanta", name: "Vanta", description: "Control-mapped evidence export.", tags: ["GRC", "Evidence", "SOC 2"], comingSoon: true },
      { key: "drata", brand: "drata", name: "Drata", description: "Control-mapped evidence export.", tags: ["GRC", "Evidence", "SOC 2"], comingSoon: true },
      { key: "secureframe", brand: "secureframe", name: "Secureframe", description: "Control-mapped evidence export.", tags: ["GRC", "Evidence", "SOC 2"], comingSoon: true },
      { key: "sprinto", brand: "sprinto", name: "Sprinto", description: "Control-mapped evidence export.", tags: ["GRC", "Evidence", "SOC 2"], comingSoon: true },
    ],
  },
  {
    id: "scanners",
    title: "Vulnerability scanners",
    blurb: "Bring scanner results into vulnerability-management evidence.",
    entries: [
      { key: "snyk", brand: "snyk", name: "Snyk", description: "Code and dependency scans.", tags: ["SAST", "Dependencies", "Code"], href: "/integrations/scanners/snyk" },
      { key: "wiz", brand: "wiz", name: "Wiz", description: "Cloud vulnerability findings.", tags: ["CSPM", "CNAPP", "Findings"], href: "/integrations/scanners/wiz" },
      { key: "tenable", brand: "tenable", name: "Tenable", description: "Vulnerability coverage evidence.", tags: ["VM", "Exposure", "Assets"], href: "/integrations/scanners/tenable" },
      { key: "qualys", brand: "qualys", name: "Qualys", description: "Scanner coverage and findings.", tags: ["VM", "Vulnerability", "Assets"], href: "/integrations/scanners/qualys" },
      { key: "orca", brand: "orca", name: "Orca", description: "Agentless cloud scan evidence.", tags: ["CSPM", "Misconfig", "Assets"], href: "/integrations/scanners/orca" },
      { key: "aikido", brand: "aikido", name: "Aikido", description: "AppSec findings as evidence.", tags: ["DAST", "SCA", "AppSec"], href: "/integrations/scanners/aikido" },
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
      { key: "jira", brand: "jira", name: "Jira", description: "Remediation tickets with sync.", tags: ["Ticketing", "Workflow", "Issues"], href: "/integrations/jira" },
      { key: "iac-repository", brand: "iac", name: "IaC repository", description: "Terraform PRs from findings.", tags: ["IaC", "Terraform", "GitOps"], href: "/integrations/iac-repository" },
      { key: "azure-devops", brand: "azure-devops", name: "Azure DevOps Pipelines", description: "Track work and pipelines.", tags: ["CI/CD", "Pipelines", "Boards"], comingSoon: true },
    ],
  },
  {
    id: "alerts",
    title: "Alerts & digests",
    blurb: "Route scan alerts and weekly digests to your team.",
    entries: [
      { key: "slack", brand: "slack", name: "Slack", description: "Alerts and weekly digests.", tags: ["Alerts", "Digests", "Channels"], href: "/integrations/slack" },
    ],
  },
];

export type ConnectedCatalogState = {
  awsConnected: boolean;
  githubConnected: boolean;
  gitlabConnected: boolean;
  googleConnected: boolean;
  entraConnected: boolean;
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

export const EXTENDED_INTEGRATION_KEYS: ReadonlySet<string> = new Set([
  "snyk",
  "wiz",
  "tenable",
  "qualys",
  "orca",
  "aikido",
  "splunk",
  "datadog",
  "elastic",
  "iac-repository",
  "azure-devops",
]);

import { SHOW_EXTENDED_INTEGRATIONS } from "./productFlags";

export function isStarterHiddenKey(key: string): boolean {
  return EXTENDED_INTEGRATION_KEYS.has(key) && !SHOW_EXTENDED_INTEGRATIONS;
}

function isComingSoonCatalogEntry(entry: CatalogEntry): boolean {
  return entry.comingSoon === true || !entry.href;
}

function isVisibleCatalogEntry(entry: CatalogEntry, hiddenKeys: ReadonlySet<string>): boolean {
  if (hiddenKeys.has(entry.key)) return false;
  return !isStarterHiddenKey(entry.key);
}

function isAvailableCatalogEntry(entry: CatalogEntry, hiddenKeys: ReadonlySet<string>): boolean {
  if (isComingSoonCatalogEntry(entry)) return false;
  return isVisibleCatalogEntry(entry, hiddenKeys);
}

function sortCatalogEntriesByName(entries: CatalogEntry[]): CatalogEntry[] {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** Catalog sections with connectable, not-yet-connected integrations (name A–Z). */
export function filterCatalog(
  catalog: CatalogCategory[],
  hiddenKeys: ReadonlySet<string>,
): CatalogCategory[] {
  return catalog
    .map((cat) => ({
      ...cat,
      entries: sortCatalogEntriesByName(
        cat.entries.filter((entry) => isAvailableCatalogEntry(entry, hiddenKeys)),
      ),
    }))
    .filter((cat) => cat.entries.length > 0);
}

/** Catalog page — includes coming-soon placeholders; excludes hidden and starter-gated entries. */
export function filterCatalogForDisplay(
  catalog: CatalogCategory[],
  hiddenKeys: ReadonlySet<string>,
): CatalogCategory[] {
  return catalog
    .map((cat) => ({
      ...cat,
      entries: sortCatalogEntriesByName(
        cat.entries.filter((entry) => isVisibleCatalogEntry(entry, hiddenKeys)),
      ),
    }))
    .filter((cat) => cat.entries.length > 0);
}

export function isCatalogEntryComingSoon(entry: CatalogEntry): boolean {
  return isComingSoonCatalogEntry(entry);
}

export function catalogExploreEntries(
  catalog: CatalogCategory[],
  hiddenKeys: ReadonlySet<string>,
): CatalogEntry[] {
  return catalog.flatMap((cat) => cat.entries.filter((entry) => isAvailableCatalogEntry(entry, hiddenKeys)));
}

export function catalogEntryCount(catalog: CatalogCategory[], hiddenKeys: ReadonlySet<string>): number {
  return catalog.reduce(
    (total, cat) => total + cat.entries.filter((entry) => isAvailableCatalogEntry(entry, hiddenKeys)).length,
    0,
  );
}

/** Source control first (change-management evidence), then workflow helpers. */
export const RECOMMENDED_INTEGRATION_TIER_1 = ["github", "gitlab"] as const;

export const RECOMMENDED_INTEGRATION_TIER_2 = ["jira", "slack"] as const;

export const RECOMMENDED_INTEGRATION_TIER_3 = ["entra", "google-workspace"] as const;

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

const RECOMMENDED_INTEGRATION_ORDER: readonly RecommendedIntegrationKey[] = [
  ...RECOMMENDED_INTEGRATION_TIER_1,
  ...RECOMMENDED_INTEGRATION_TIER_2,
  ...RECOMMENDED_INTEGRATION_TIER_3,
];

/** Hub explore strip — all unconnected starter-visible integrations; recommended tiers first, then A–Z. */
export function getExploreStripEntries(hiddenKeys: ReadonlySet<string>): CatalogEntry[] {
  const available = sortCatalogEntriesByName(catalogExploreEntries(INTEGRATION_CATALOG, hiddenKeys));
  const recommendedSet = new Set<string>(RECOMMENDED_INTEGRATION_ORDER);
  const byKey = new Map(available.map((entry) => [entry.key, entry]));

  const ordered: CatalogEntry[] = [];
  for (const key of RECOMMENDED_INTEGRATION_ORDER) {
    const entry = byKey.get(key);
    if (entry) ordered.push(entry);
  }
  for (const entry of available) {
    if (!recommendedSet.has(entry.key)) ordered.push(entry);
  }
  return ordered;
}
