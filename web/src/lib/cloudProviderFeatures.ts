import type { ScopeProvider } from "../components/AccountSelect";

/** Cloud accounts with full compliance/history support today. */
export function isAwsCloudProvider(provider?: ScopeProvider): boolean {
  return !provider || provider === "aws";
}

/** GCP and Azure — UI-only placeholders until multi-cloud compliance ships. */
export function isCloudFeatureComingSoon(provider?: ScopeProvider): boolean {
  return provider === "gcp" || provider === "azure";
}
