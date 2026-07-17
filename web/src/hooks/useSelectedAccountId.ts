import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  accountIdFromSearchParams,
  readStoredSelectedAccountId,
  resolveSelectedAccountId,
  type AccountScopeStorage,
  type ResolveSelectedAccountOptions,
  writeStoredSelectedAccountId,
} from "../lib/selectedAccountStorage";
import type { ConnectedAccountOption } from "./useConnectedAccountOptions";

type SetAccountIdOptions = {
  /** Extra query params to remove when the account changes (e.g. Findings `provider`). */
  removeParams?: string[];
};

export function useSelectedAccountId(
  connectedAccounts: ConnectedAccountOption[],
  accountsReady: boolean,
  options?: {
    holdUrlSyncWhenParams?: string[];
    scopeDefaults?: Pick<
      ResolveSelectedAccountOptions,
      "cloudAccountCount" | "hasSourceControl" | "hasIdentity" | "scopeIds"
    >;
    /** Never write `account_id` into the URL or sessionStorage (org readiness home:
     *  bare `/home` must stay unscoped instead of auto-selecting a persisted account). */
    disableUrlSync?: boolean;
    /** Override default `veritrail.selectedAccountId` persistence (e.g. Findings scope picker). */
    storage?: AccountScopeStorage;
  },
) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlAccountId = accountIdFromSearchParams(searchParams);
  const connectedIds = useMemo(() => connectedAccounts.map((account) => account.id), [connectedAccounts]);
  const readStored = options?.storage?.read ?? readStoredSelectedAccountId;
  const writeStored = options?.storage?.write ?? writeStoredSelectedAccountId;
  const scopeIds = options?.scopeDefaults?.scopeIds;

  const accountId = useMemo(() => {
    if (!accountsReady || connectedIds.length === 0) {
      return (urlAccountId ?? "").trim();
    }
    return resolveSelectedAccountId(connectedIds, {
      urlAccountId,
      storedAccountId: readStored(),
      ...options?.scopeDefaults,
    });
  }, [accountsReady, connectedIds, options?.scopeDefaults, readStored, urlAccountId]);

  const holdUrlSync =
    (options?.disableUrlSync ?? false) ||
    (options?.holdUrlSyncWhenParams ?? []).some((key) => searchParams.has(key)) ||
    (!!accountId && !!scopeIds?.includes(accountId));

  const activeAccount = useMemo(
    () => connectedAccounts.find((account) => account.id === accountId) ?? connectedAccounts[0],
    [accountId, connectedAccounts],
  );

  const effectiveAccountId = accountId || activeAccount?.id || "";

  useEffect(() => {
    if (!accountsReady || !effectiveAccountId || holdUrlSync) return;

    writeStored(effectiveAccountId);

    const canonical = searchParams.get("account_id");
    const legacy = searchParams.get("account");
    if (canonical === effectiveAccountId && !legacy) return;

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("account_id", effectiveAccountId);
        next.delete("account");
        return next;
      },
      { replace: true },
    );
  }, [accountsReady, effectiveAccountId, holdUrlSync, searchParams, setSearchParams, writeStored]);

  const setAccountId = useCallback(
    (id: string, options?: SetAccountIdOptions) => {
      writeStored(id);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("account_id", id);
          else next.delete("account_id");
          next.delete("account");
          for (const key of options?.removeParams ?? []) next.delete(key);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, writeStored],
  );

  return { accountId: effectiveAccountId, activeAccount, setAccountId };
}
