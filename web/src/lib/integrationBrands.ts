import { AWS_LOGO_LIGHT } from "./awsBrand";

export type IntegrationBrandId =
  | "aws"
  | "github"
  | "gitlab"
  | "google-workspace"
  | "entra"
  | "slack"
  | "jira"
  | "azure-devops"
  | "datadog";

type BrandAsset = {
  src: string;
  fallback?: string;
  /** Press-kit art with extra padding — scale up inside the tile. */
  tileScale?: number;
  /** Tile inner padding (px). Default 8. */
  tilePadding?: number;
};

/** Official brand marks / favicons for integration UI. */
export const INTEGRATION_BRAND: Record<IntegrationBrandId, BrandAsset> = {
  aws: { src: AWS_LOGO_LIGHT, fallback: "/aws.svg" },
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
};
