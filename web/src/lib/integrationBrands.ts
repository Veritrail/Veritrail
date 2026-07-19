export type IntegrationBrandId =
  | "aws"
  | "iac"
  | "github"
  | "gitlab"
  | "google-workspace"
  | "entra"
  | "slack"
  | "jira"
  | "pagerduty"
  | "azure-devops"
  | "datadog"
  | "gcp"
  | "azure"
  | "wiz"
  | "tenable"
  | "qualys"
  | "snyk"
  | "orca"
  | "aikido"
  | "splunk"
  | "elastic"
  | "vanta"
  | "drata"
  | "secureframe"
  | "sprinto";

type BrandAsset = {
  src: string;
  fallback?: string;
  /** Square icon / favicon for compact UI (header pills, list rows). */
  compactSrc?: string;
  compactFallback?: string;
  /** Press-kit art with extra padding — scale up inside the tile. */
  tileScale?: number;
  /** Tile inner padding (px). Default 8. */
  tilePadding?: number;
};

/** Official brand marks / favicons for integration UI. */
export const INTEGRATION_BRAND: Record<IntegrationBrandId, BrandAsset> = {
  // AWS/GCP live under /brand/ (edge-allowlisted like the login mark). Avoid
  // /integrations/*.png — that prefix is also an SPA route and is easy to break
  // behind the edge proxy (same class of bug as the pre-allowlist login logo 404).
  aws: {
    src: "/brand/aws.png",
    fallback: "/aws.png",
    compactSrc: "/aws-account-icon.png",
    compactFallback: "/aws.png",
  },
  iac: { src: "/integrations/terraform.png", tileScale: 1.05, tilePadding: 6 },
  github: { src: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png" },
  gitlab: { src: "/integrations/gitlab.png", tileScale: 1.32, tilePadding: 4 },
  "google-workspace": { src: "https://www.google.com/favicon.ico" },
  entra: {
    src: "/integrations/entra.png",
    compactSrc: "/integrations/entra.png",
  },
  slack: { src: "https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png" },
  jira: { src: "https://jira.atlassian.com/favicon.ico" },
  pagerduty: { src: "https://www.pagerduty.com/favicon.ico" },
  "azure-devops": { src: "/integrations/azure-devops.png" },
  datadog: { src: "https://www.datadoghq.com/favicon.ico" },
  gcp: {
    src: "/brand/gcp.png",
    compactSrc: "/brand/gcp.png",
    fallback: "https://www.gstatic.com/images/branding/product/2x/google_cloud_48dp.png",
  },
  azure: { src: "/integrations/azure.png", compactSrc: "/integrations/azure.png" },
  wiz: { src: "/integrations/wiz.png", tileScale: 1.08, tilePadding: 4 },
  tenable: { src: "/integrations/tenable.png" },
  qualys: { src: "/integrations/qualys.png", tileScale: 0.92 },
  snyk: { src: "/integrations/snyk.png", tileScale: 0.92 },
  orca: { src: "/integrations/orca.png" },
  aikido: { src: "/integrations/aikido.png", tileScale: 1.08 },
  splunk: { src: "/integrations/splunk.png", compactSrc: "/integrations/splunk.png" },
  elastic: { src: "https://www.elastic.co/favicon.ico" },
  vanta: { src: "/integrations/vanta.png", tileScale: 1.08, tilePadding: 6 },
  drata: { src: "/integrations/drata.png", tileScale: 1.05, tilePadding: 4 },
  secureframe: { src: "/integrations/secureframe.png", tileScale: 1.05 },
  sprinto: { src: "/integrations/sprinto.png", tileScale: 1.05 },
};
