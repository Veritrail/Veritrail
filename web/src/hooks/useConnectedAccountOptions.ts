import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { accountListSchema } from "../lib/apiSchemas";
import { isAccountConnected } from "../lib/accountConnection";
import type { AccountOption, CloudProvider } from "../components/AccountSelect";

export type CloudAccountRow = {
  provider: string;
  id: string;
  external_id: string | null;
  label: string;
  status: string;
  last_scan_at: string | null;
};

export type ConnectedAccountOption = AccountOption & {
  last_scan_at?: string | null;
};

export function isCloudAccountConnected(row: CloudAccountRow): boolean {
  return row.status === "connected";
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

export function findingsScopeParams(account: AccountOption | undefined): FindingsScopeParams {
  if (!account) return {};
  if (account.provider === "gcp") return { gcp_project_id: account.id };
  if (account.provider === "azure") return { azure_subscription_id: account.id };
  return { account_id: account.id };
}

export function useConnectedAccountOptions() {
  const accountsQ = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api("/v1/accounts", { schema: accountListSchema }),
  });
  const cloudAccountsQ = useQuery({
    queryKey: ["cloud-accounts"],
    queryFn: () => api<CloudAccountRow[]>("/v1/integrations/cloud-accounts"),
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
