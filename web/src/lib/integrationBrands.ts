export type IntegrationBrandId =
  | "aws"
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
  github: { src: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png" },
  gitlab: { src: "/integrations/gitlab.png", tileScale: 1.32, tilePadding: 4 },
  "google-workspace": { src: "https://www.google.com/favicon.ico" },
  entra: {
    src: "https://aadcdn.msftauth.net/shared/1.0/content/images/favicon_a_eupayfgghqiai7k9sol6lg2.ico",
  },
  slack: { src: "https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png" },
  jira: { src: "https://jira.atlassian.com/favicon.ico" },
  "azure-devops": { src: "/integrations/azure-devops.png" },
  datadog: { src: "https://www.datadoghq.com/favicon.ico" },
  gcp: { src: "/integrations/gcp.png", compactSrc: "/integrations/gcp.png" },
  azure: { src: "/integrations/azure.png", compactSrc: "/integrations/azure.png" },
  wiz: { src: "https://www.wiz.io/favicon.ico" },
  tenable: { src: "https://www.tenable.com/favicon.ico" },
  qualys: { src: "https://www.qualys.com/favicon.ico" },
  snyk: { src: "https://snyk.io/favicon.ico" },
  orca: { src: "https://orca.security/favicon.ico" },
  aikido: { src: "https://www.aikido.dev/favicon.ico" },
  okta: { src: "https://www.okta.com/favicon.ico" },
  splunk: { src: "https://www.splunk.com/favicon.ico" },
  elastic: { src: "https://www.elastic.co/favicon.ico" },
};
