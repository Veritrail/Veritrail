export type IntegrationBrandId =
  | "aws"
  | "iac"
  | "github"
  | "gitlab"
  | "google-workspace"
  | "entra"
  | "slack"
  | "jira"
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
  | "okta"
  | "splunk"
  | "elastic";

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
  aws: {
    src: "/integrations/aws.png",
    fallback: "/aws-account-icon.png",
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
  "azure-devops": { src: "/integrations/azure-devops.png" },
  datadog: { src: "https://www.datadoghq.com/favicon.ico" },
  gcp: { src: "/integrations/gcp.png", compactSrc: "/integrations/gcp.png" },
  azure: { src: "/integrations/azure.png", compactSrc: "/integrations/azure.png" },
  wiz: { src: "/integrations/wiz.png", tileScale: 1.08, tilePadding: 4 },
  tenable: { src: "/integrations/tenable.png" },
  qualys: { src: "/integrations/qualys.png", tileScale: 0.92 },
  snyk: { src: "/integrations/snyk.png", tileScale: 0.92 },
  orca: { src: "/integrations/orca.png" },
  aikido: { src: "/integrations/aikido.png", tileScale: 1.08 },
  okta: { src: "/integrations/okta.png" },
  splunk: { src: "/integrations/splunk.png", compactSrc: "/integrations/splunk.png" },
  elastic: { src: "https://www.elastic.co/favicon.ico" },
};
