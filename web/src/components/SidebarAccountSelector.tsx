import { useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { AccountFilterDropdown } from "./AccountFilterDropdown";
import {
  buildFindingsScopeGroups,
  flattenScopeGroups,
  findingsScopeDropdownValue,
  parseFindingsProviderScope,
  SCOPE_SENTINEL_PREFIX,
  useConnectedAccountOptions,
} from "../hooks/useConnectedAccountOptions";
import { useSelectedAccountId } from "../hooks/useSelectedAccountId";
import { integrationStatusNullableSchema } from "../lib/apiSchemas";
import { writeStoredSelectedAccountId } from "../lib/selectedAccountStorage";

function scopeSentinelToProvider(scope: string): string | null {
  if (scope === "all_cloud") return "all_cloud";
  if (scope === "source_control") return "source_control";
  if (scope === "identity") return "identity";
  return null;
}

export function SidebarAccountSelector({ collapsed }: { collapsed: boolean }) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const onFindings = location.pathname === "/findings";
  const onOrgHome =
    (location.pathname === "/accounts" || location.pathname === "/home") &&
    searchParams.get("view") !== "all" &&
    !searchParams.get("account_id") &&
    !searchParams.get("account");

  const { options: cloudAccounts, isSuccess: accountsReady } = useConnectedAccountOptions();

  const githubProviderQ = useQuery({
    queryKey: ["github-provider"],
    queryFn: () => api("/v1/integrations/github", { schema: integrationStatusNullableSchema }),
    staleTime: 300_000,
    enabled: onFindings,
  });
  const gitlabProviderQ = useQuery({
    queryKey: ["gitlab-provider"],
    queryFn: () => api("/v1/integrations/gitlab", { schema: integrationStatusNullableSchema }),
    staleTime: 300_000,
    enabled: onFindings,
  });
  const entraProviderQ = useQuery({
    queryKey: ["integration", "entra"],
    queryFn: () => api("/v1/integrations/entra", { schema: integrationStatusNullableSchema }),
    staleTime: 300_000,
    enabled: onFindings,
  });
  const googleWorkspaceProviderQ = useQuery({
    queryKey: ["integration", "google-workspace"],
    queryFn: () => api("/v1/integrations/google-workspace", { schema: integrationStatusNullableSchema }),
    staleTime: 300_000,
    enabled: onFindings,
  });

  const hasGithub = !!githubProviderQ.data;
  const hasGitlab = !!gitlabProviderQ.data;
  const hasIdentity = !!entraProviderQ.data || !!googleWorkspaceProviderQ.data;

  const scopeGroups = useMemo(
    () =>
      onFindings
        ? buildFindingsScopeGroups(cloudAccounts, { hasGithub, hasGitlab, hasIdentity })
        : [],
    [cloudAccounts, hasGithub, hasGitlab, hasIdentity, onFindings],
  );
  const connectedScopeOptions = useMemo(() => flattenScopeGroups(scopeGroups), [scopeGroups]);
  const providerScope = onFindings ? parseFindingsProviderScope(searchParams.get("provider")) : null;

  const pickerAccounts = onFindings ? connectedScopeOptions : cloudAccounts;
  const { accountId, setAccountId } = useSelectedAccountId(pickerAccounts, accountsReady, {
    disableUrlSync: onOrgHome,
    holdUrlSyncWhenParams: onFindings ? ["provider"] : undefined,
    scopeDefaults: onFindings
      ? {
          cloudAccountCount: cloudAccounts.length,
          hasSourceControl: hasGithub || hasGitlab,
          hasIdentity,
        }
      : undefined,
  });

  function handleChange(id: string) {
    if (onFindings && id.startsWith(SCOPE_SENTINEL_PREFIX)) {
      const scope = id.slice(SCOPE_SENTINEL_PREFIX.length);
      const provider = scopeSentinelToProvider(scope);
      if (!provider) return;
      writeStoredSelectedAccountId(id);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("provider", provider);
          next.delete("account_id");
          return next;
        },
        { replace: true },
      );
      return;
    }
    writeStoredSelectedAccountId(id);
    setAccountId(id, onFindings ? { removeParams: ["provider"] } : undefined);
  }

  if (!accountsReady || pickerAccounts.length === 0) return null;

  const dropdownValue = onFindings
    ? findingsScopeDropdownValue(providerScope, accountId)
    : accountId;

  return (
    <div className={`app-sidebar__account${collapsed ? " is-collapsed" : ""}`}>
      <AccountFilterDropdown
        accounts={pickerAccounts}
        groups={
          onFindings
            ? scopeGroups.map((group) => ({ heading: group.heading, accounts: group.options }))
            : undefined
        }
        value={dropdownValue}
        onChange={handleChange}
        variant="sidebar"
      />
    </div>
  );
}
