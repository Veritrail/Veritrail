import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { accountListSchema, cloudAccountListSchema, type CloudAccountRow } from "../lib/apiSchemas";
import { isAccountConnected } from "../lib/accountConnection";
import type { AccountOption, CloudProvider } from "../components/AccountSelect";

export type { CloudAccountRow };

export type ConnectedAccountOption = AccountOption & {
  last_scan_at?: string | null;
  scopeMeta?: string | null;
};

/** Account is usable (connected, or needs reconnect after verify/scan failure).
    Only reads `status` — callers pass several CloudAccountRow shapes. */
export function isCloudAccountConnected(row: { status: string }): boolean {
  return row.status === "connected" || row.status === "error";
}

export function awsAccountToOption(acc: {
  id: string;
  label: string | null;
  account_id: string | null;
  last_scan_at?: string | null;
}): ConnectedAccountOption {
  return {
    id: acc.id,
    label: acc.label,
    account_id: acc.account_id,
    provider: "aws",
    last_scan_at: acc.last_scan_at ?? null,
  };
}

export function cloudAccountToOption(cloud: CloudAccountRow): ConnectedAccountOption {
  return {
    id: cloud.id,
    label: cloud.label,
    account_id: cloud.external_id,
    provider: cloud.provider as CloudProvider,
    last_scan_at: cloud.last_scan_at,
  };
}

export type FindingsScopeParams = {
  account_id?: string;
  gcp_project_id?: string;
  azure_subscription_id?: string;
  provider?: FindingsProviderScope;
};

export type FindingsProviderScope = "github" | "gitlab" | "source_control" | "all_cloud";

/** Sentinel id prefix for org-level scope options in the account picker. */
export const SCOPE_SENTINEL_PREFIX = "scope:";

/** @deprecated Use SCOPE_SENTINEL_PREFIX */
export const SOURCE_CONTROL_SCOPE_PREFIX = SCOPE_SENTINEL_PREFIX;

export const ALL_CLOUD_SCOPE_ID = `${SCOPE_SENTINEL_PREFIX}all_cloud`;
export const SOURCE_CONTROL_SCOPE_ID = `${SCOPE_SENTINEL_PREFIX}source_control`;

export function allCloudScopeOption(): ConnectedAccountOption {
  return {
    id: ALL_CLOUD_SCOPE_ID,
    label: "All accounts",
    account_id: null,
    provider: "all_cloud",
    scopeMeta: "AWS · GCP · Azure",
  };
}

export function sourceControlScopeOption(meta = "GitHub · GitLab"): ConnectedAccountOption {
  return {
    id: SOURCE_CONTROL_SCOPE_ID,
    label: "Source control",
    account_id: null,
    provider: "source_control",
    scopeMeta: meta,
  };
}

export type FindingsScopeOptionGroup = {
  heading?: string;
  options: ConnectedAccountOption[];
};

export function buildFindingsScopeGroups(
  cloudAccounts: ConnectedAccountOption[],
  opts: { hasGithub: boolean; hasGitlab: boolean },
): FindingsScopeOptionGroup[] {
  const groups: FindingsScopeOptionGroup[] = [];
  if (cloudAccounts.length >= 1) {
    groups.push({ options: [allCloudScopeOption()] });
    groups.push({ heading: "Cloud accounts", options: cloudAccounts });
  }
  if (opts.hasGithub || opts.hasGitlab) {
    const meta = [opts.hasGithub ? "GitHub" : null, opts.hasGitlab ? "GitLab" : null]
      .filter(Boolean)
      .join(" · ");
    groups.push({ heading: "Source control", options: [sourceControlScopeOption(meta)] });
  }
  return groups;
}

export function flattenScopeGroups(groups: readonly FindingsScopeOptionGroup[]): ConnectedAccountOption[] {
  return groups.flatMap((group) => group.options);
}

export function parseFindingsProviderScope(value: string | null): FindingsProviderScope | null {
  if (
    value === "all_cloud" ||
    value === "source_control" ||
    value === "github" ||
    value === "gitlab"
  ) {
    return value;
  }
  return null;
}

export function isOrgLevelFindingsProvider(scope: FindingsProviderScope): boolean {
  return scope === "all_cloud" || scope === "source_control" || scope === "github" || scope === "gitlab";
}

export function findingsProviderForApi(scope: FindingsProviderScope): FindingsProviderScope {
  return scope;
}

export function findingsScopeDropdownValue(
  providerScope: FindingsProviderScope | null,
  accountId: string,
): string {
  if (providerScope === "all_cloud") return ALL_CLOUD_SCOPE_ID;
  if (
    providerScope === "source_control" ||
    providerScope === "github" ||
    providerScope === "gitlab"
  ) {
    return SOURCE_CONTROL_SCOPE_ID;
  }
  return accountId;
}

export function findingsScopeParams(account: AccountOption | undefined): FindingsScopeParams {
  if (!account) return {};
  if (account.provider === "all_cloud") return { provider: "all_cloud" };
  if (account.provider === "source_control") return { provider: "source_control" };
  if (account.provider === "gcp") return { gcp_project_id: account.id };
  if (account.provider === "azure") return { azure_subscription_id: account.id };
  if (account.provider === "github" || account.provider === "gitlab") return { provider: account.provider };
  return { account_id: account.id };
}

export function useConnectedAccountOptions() {
  const accountsQ = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api("/v1/accounts", { schema: accountListSchema }),
  });
  const cloudAccountsQ = useQuery({
    queryKey: ["cloud-accounts"],
    queryFn: () => api("/v1/integrations/cloud-accounts", { schema: cloudAccountListSchema }),
  });

  const options = useMemo(() => {
    const aws = (accountsQ.data ?? []).filter(isAccountConnected).map(awsAccountToOption);
    const cloud = (cloudAccountsQ.data ?? [])
      .filter((row) => row.provider === "gcp" || row.provider === "azure")
      .filter(isCloudAccountConnected)
      .map(cloudAccountToOption);
    return [...aws, ...cloud];
  }, [accountsQ.data, cloudAccountsQ.data]);

  return {
    options,
    isLoading: accountsQ.isLoading || cloudAccountsQ.isLoading,
    isSuccess: accountsQ.isSuccess && cloudAccountsQ.isSuccess,
    accountsQ,
    cloudAccountsQ,
  };
}
