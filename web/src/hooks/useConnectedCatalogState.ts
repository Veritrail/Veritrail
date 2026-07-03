import { useQuery } from "@tanstack/react-query";

import { api } from "../api";
import {
  azureBoardsIntegrationSchema,
  cloudAccountListSchema,
  iacRepositoryIntegrationSchema,
  integrationStatusNullableSchema,
  jiraIntegrationSchema,
  oktaIntegrationSchema,
  scannerIntegrationSchema,
  settingsSchema,
} from "../lib/apiSchemas";
import { connectedCatalogKeys, type ConnectedCatalogState } from "../lib/integrationCatalog";
import { isCloudAccountConnected } from "./useConnectedAccountOptions";

export function useConnectedCatalogState() {
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api("/v1/settings", { schema: settingsSchema }),
  });
  const github = useQuery({
    queryKey: ["github-provider"],
    queryFn: () => api("/v1/integrations/github", { schema: integrationStatusNullableSchema }),
  });
  const gitlab = useQuery({
    queryKey: ["gitlab-provider"],
    queryFn: () => api("/v1/integrations/gitlab", { schema: integrationStatusNullableSchema }),
  });
  const googleWorkspace = useQuery({
    queryKey: ["google-workspace-provider"],
    queryFn: () => api("/v1/integrations/google-workspace", { schema: integrationStatusNullableSchema }),
  });
  const entra = useQuery({
    queryKey: ["entra-provider"],
    queryFn: () => api("/v1/integrations/entra", { schema: integrationStatusNullableSchema }),
  });
  const okta = useQuery({
    queryKey: ["okta-integration"],
    queryFn: () => api("/v1/integrations/okta", { schema: oktaIntegrationSchema }),
  });
  const cloudAccounts = useQuery({
    queryKey: ["cloud-accounts"],
    queryFn: () => api("/v1/integrations/cloud-accounts", { schema: cloudAccountListSchema }),
  });
  const wizScanner = useQuery({
    queryKey: ["scanner-wiz"],
    queryFn: () => api("/v1/integrations/scanners/wiz", { schema: scannerIntegrationSchema }),
  });
  const tenableScanner = useQuery({
    queryKey: ["scanner-tenable"],
    queryFn: () => api("/v1/integrations/scanners/tenable", { schema: scannerIntegrationSchema }),
  });
  const qualysScanner = useQuery({
    queryKey: ["scanner-qualys"],
    queryFn: () => api("/v1/integrations/scanners/qualys", { schema: scannerIntegrationSchema }),
  });
  const snykScanner = useQuery({
    queryKey: ["scanner-snyk"],
    queryFn: () => api("/v1/integrations/scanners/snyk", { schema: scannerIntegrationSchema }),
  });
  const orcaScanner = useQuery({
    queryKey: ["scanner-orca"],
    queryFn: () => api("/v1/integrations/scanners/orca", { schema: scannerIntegrationSchema }),
  });
  const aikidoScanner = useQuery({
    queryKey: ["scanner-aikido"],
    queryFn: () => api("/v1/integrations/scanners/aikido", { schema: scannerIntegrationSchema }),
  });
  const iacRepository = useQuery({
    queryKey: ["iac-repository-integration"],
    queryFn: () => api("/v1/integrations/iac-repository", { schema: iacRepositoryIntegrationSchema }),
  });
  const jira = useQuery({
    queryKey: ["jira-integration"],
    queryFn: () => api("/v1/integrations/jira", { schema: jiraIntegrationSchema }),
  });
  const azureBoards = useQuery({
    queryKey: ["azure-boards-integration"],
    queryFn: () => api("/v1/integrations/azure-boards", { schema: azureBoardsIntegrationSchema }),
  });
  const splunkSiem = useQuery({
    queryKey: ["siem-splunk"],
    queryFn: () => api("/v1/integrations/siem/splunk", { schema: scannerIntegrationSchema }),
  });
  const datadogSiem = useQuery({
    queryKey: ["siem-datadog"],
    queryFn: () => api("/v1/integrations/siem/datadog", { schema: scannerIntegrationSchema }),
  });

  const accountsList = cloudAccounts.data ?? [];
  const awsRows = accountsList.filter((a) => a.provider === "aws");
  const gcpRows = accountsList.filter((a) => a.provider === "gcp");
  const azureRows = accountsList.filter((a) => a.provider === "azure");
  const awsAccount = awsRows.find((a) => a.status === "connected") ?? awsRows[0];

  const state: ConnectedCatalogState = {
    awsConnected: awsAccount?.status === "connected",
    githubConnected: !!github.data,
    gitlabConnected: !!gitlab.data,
    googleConnected: !!googleWorkspace.data,
    entraConnected: !!entra.data,
    oktaConnected: !!okta.data?.connected,
    slackConnected: !!settings.data?.notifications.slack_webhook_url?.trim(),
    gcpConnected: gcpRows.some(isCloudAccountConnected),
    azureConnected: azureRows.some(isCloudAccountConnected),
    iacRepositoryConnected: !!iacRepository.data?.connected,
    jiraConnected: !!jira.data?.connected,
    azureBoardsConnected: !!azureBoards.data?.connected,
    splunkConnected: !!splunkSiem.data?.connected,
    datadogConnected: !!datadogSiem.data?.connected,
    connectedScanners: {
      snyk: !!snykScanner.data?.connected,
      wiz: !!wizScanner.data?.connected,
      tenable: !!tenableScanner.data?.connected,
      qualys: !!qualysScanner.data?.connected,
      orca: !!orcaScanner.data?.connected,
      aikido: !!aikidoScanner.data?.connected,
    },
  };

  return {
    state,
    hiddenKeys: connectedCatalogKeys(state),
    isLoading:
      settings.isLoading ||
      github.isLoading ||
      gitlab.isLoading ||
      googleWorkspace.isLoading ||
      entra.isLoading ||
      okta.isLoading ||
      cloudAccounts.isLoading ||
      wizScanner.isLoading ||
      tenableScanner.isLoading ||
      qualysScanner.isLoading ||
      snykScanner.isLoading ||
      orcaScanner.isLoading ||
      aikidoScanner.isLoading ||
      iacRepository.isLoading ||
      jira.isLoading ||
      azureBoards.isLoading ||
      splunkSiem.isLoading ||
      datadogSiem.isLoading,
  };
}
