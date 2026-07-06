import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { accountListSchema, cloudAccountListSchema, type CloudAccountRow } from "../lib/apiSchemas";
import { isAccountConnected } from "../lib/accountConnection";
import type { AccountOption, CloudProvider } from "../components/AccountSelect";

export type { CloudAccountRow };

export type ConnectedAccountOption = AccountOption & {
  last_scan_at?: string | null;
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
};

/** Sentinel id prefix for source-control scope options in the account picker.
    They resolve to ?provider=github|gitlab, not a cloud account. */
export const SOURCE_CONTROL_SCOPE_PREFIX = "scope:";

export function sourceControlScopeOption(provider: "github" | "gitlab"): ConnectedAccountOption {
  return {
    id: `${SOURCE_CONTROL_SCOPE_PREFIX}${provider}`,
    label: provider === "github" ? "GitHub" : "GitLab",
    account_id: null,
    provider,
  };
}

export function findingsScopeParams(account: AccountOption | undefined): FindingsScopeParams {
  if (!account) return {};
  if (account.provider === "gcp") return { gcp_project_id: account.id };
  if (account.provider === "azure") return { azure_subscription_id: account.id };
  // Source control uses the ?provider scope, not a cloud-account param.
  if (account.provider === "github" || account.provider === "gitlab") return {};
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
