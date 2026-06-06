import { useMutationState } from "@tanstack/react-query";

export const GITHUB_SYNC_KEY = ["integration-sync", "github"] as const;
export const GITLAB_SYNC_KEY = ["integration-sync", "gitlab"] as const;
export const GOOGLE_WORKSPACE_SYNC_KEY = ["integration-sync", "google-workspace"] as const;
export const ENTRA_SYNC_KEY = ["integration-sync", "entra"] as const;

type IntegrationProvider = "github" | "gitlab" | "google-workspace" | "entra";

const KEYS: Record<IntegrationProvider, readonly ["integration-sync", string]> = {
  github: GITHUB_SYNC_KEY,
  gitlab: GITLAB_SYNC_KEY,
  "google-workspace": GOOGLE_WORKSPACE_SYNC_KEY,
  entra: ENTRA_SYNC_KEY,
};

export function useIntegrationSyncState(provider: IntegrationProvider) {
  const mutationKey = KEYS[provider];
  const pending = useMutationState({
    filters: { mutationKey: [...mutationKey], status: "pending" },
  });
  return { isSyncing: pending.length > 0, syncMutation: { error: null as Error | null } };
}
