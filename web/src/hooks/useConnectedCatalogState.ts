import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { api } from "../api";
import {
  cloudAccountListSchema,
  iacRepositoryIntegrationSchema,
  integrationStatusNullableSchema,
  jiraIntegrationSchema,
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
  const splunkSiem = useQuery({
    queryKey: ["siem-integration", "splunk"],
    queryFn: () => api("/v1/integrations/siem/splunk", { schema: scannerIntegrationSchema }),
  });
  const datadogSiem = useQuery({
    queryKey: ["siem-integration", "datadog"],
    queryFn: () => api("/v1/integrations/siem/datadog", { schema: scannerIntegrationSchema }),
  });

  const accountsList = cloudAccounts.data ?? [];
  const awsRows = accountsList.filter((a) => a.provider === "aws");
  const gcpRows = accountsList.filter((a) => a.provider === "gcp");
  const azureRows = accountsList.filter((a) => a.provider === "azure");
  const awsAccount = awsRows.find((a) => a.status === "connected") ?? awsRows[0];

  const awsConnected = awsAccount?.status === "connected";
  const githubConnected = !!github.data;
  const gitlabConnected = !!gitlab.data;
  const googleConnected = !!googleWorkspace.data;
  const entraConnected = !!entra.data;
  const slackConnected = !!settings.data?.notifications.slack_webhook_url?.trim();
  const gcpConnected = gcpRows.some(isCloudAccountConnected);
  const azureConnected = azureRows.some(isCloudAccountConnected);
  const iacRepositoryConnected = !!iacRepository.data?.connected;
  const jiraConnected = !!jira.data?.connected;
  const splunkConnected = !!splunkSiem.data?.connected;
  const datadogConnected = !!datadogSiem.data?.connected;
  const snykConnected = !!snykScanner.data?.connected;
  const wizConnected = !!wizScanner.data?.connected;
  const tenableConnected = !!tenableScanner.data?.connected;
  const qualysConnected = !!qualysScanner.data?.connected;
  const orcaConnected = !!orcaScanner.data?.connected;
  const aikidoConnected = !!aikidoScanner.data?.connected;

  const state: ConnectedCatalogState = {
    awsConnected,
    githubConnected,
    gitlabConnected,
    googleConnected,
    entraConnected,
    slackConnected,
    gcpConnected,
    azureConnected,
    iacRepositoryConnected,
    jiraConnected,
    splunkConnected,
    datadogConnected,
    connectedScanners: {
      snyk: snykConnected,
      wiz: wizConnected,
      tenable: tenableConnected,
      qualys: qualysConnected,
      orca: orcaConnected,
      aikido: aikidoConnected,
    },
  };

  const hiddenKeys = useMemo(
    () => connectedCatalogKeys(state),
    [
      awsConnected,
      githubConnected,
      gitlabConnected,
      googleConnected,
      entraConnected,
      slackConnected,
      gcpConnected,
      azureConnected,
      iacRepositoryConnected,
      jiraConnected,
      splunkConnected,
      datadogConnected,
      snykConnected,
      wizConnected,
      tenableConnected,
      qualysConnected,
      orcaConnected,
      aikidoConnected,
    ],
  );

  return {
    state,
    hiddenKeys,
    isLoading:
      settings.isLoading ||
      github.isLoading ||
      gitlab.isLoading ||
      googleWorkspace.isLoading ||
      entra.isLoading ||
      cloudAccounts.isLoading ||
      wizScanner.isLoading ||
      tenableScanner.isLoading ||
      qualysScanner.isLoading ||
      snykScanner.isLoading ||
      orcaScanner.isLoading ||
      aikidoScanner.isLoading ||
      iacRepository.isLoading ||
      jira.isLoading ||
      splunkSiem.isLoading ||
      datadogSiem.isLoading,
  };
}
