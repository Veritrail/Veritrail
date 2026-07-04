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

export function filterCatalog(
  catalog: CatalogCategory[],
  hiddenKeys: ReadonlySet<string>,
  query = "",
): CatalogCategory[] {
  const q = query.trim().toLowerCase();
  return catalog
    .map((cat) => ({
      ...cat,
      entries: cat.entries.filter((entry) => {
        if (hiddenKeys.has(entry.key)) return false;
        if (!q) return true;
        return entry.name.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q);
      }),
    }))
    .filter((cat) => cat.entries.length > 0);
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

/** Priority-ordered keys for the integrations hub recommendation strip.
 *  Google Workspace is preferred over Microsoft Entra ID when both are candidates.
 *  Cloud providers (AWS/GCP/Azure) are excluded — they onboard from Accounts. */
export const RECOMMENDED_INTEGRATION_KEYS = [
  "iac-repository",
  "google-workspace",
  "jira",
  "snyk",
  "entra",
  "github",
  "okta",
  "slack",
  "gitlab",
  "aikido",
  "wiz",
  "datadog",
  "splunk",
  "tenable",
  "qualys",
  "orca",
] as const;

/** Connector cards shown inline; browse-catalog card is always the 4th slot. */
export const MAX_INLINE_RECOMMENDED_CARDS = 3;

export type RecommendedIntegrationKey = (typeof RECOMMENDED_INTEGRATION_KEYS)[number];

export function catalogEntryByKey(key: string): CatalogEntry | undefined {
  for (const category of INTEGRATION_CATALOG) {
    const entry = category.entries.find((e) => e.key === key);
    if (entry) return entry;
  }
  return undefined;
}

/** Top N connectable recommendations that are not yet connected. */
export function getRecommendedIntegrationKeys(
  hiddenKeys: ReadonlySet<string>,
  limit = MAX_INLINE_RECOMMENDED_CARDS,
): RecommendedIntegrationKey[] {
  const keys: RecommendedIntegrationKey[] = [];
  for (const key of RECOMMENDED_INTEGRATION_KEYS) {
    if (hiddenKeys.has(key)) continue;
    const entry = catalogEntryByKey(key);
    if (!entry?.href || entry.comingSoon) continue;
    keys.push(key);
    if (keys.length >= limit) break;
  }
  return keys;
}
