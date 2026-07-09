import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  accountIdFromSearchParams,
  resolveSelectedAccountId,
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
    scopeDefaults?: Pick<ResolveSelectedAccountOptions, "cloudAccountCount" | "hasSourceControl" | "hasIdentity">;
  },
) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlAccountId = accountIdFromSearchParams(searchParams);
  const connectedIds = useMemo(() => connectedAccounts.map((account) => account.id), [connectedAccounts]);
  const holdUrlSync = (options?.holdUrlSyncWhenParams ?? []).some((key) => searchParams.has(key));

  const accountId = useMemo(() => {
    if (!accountsReady || connectedIds.length === 0) {
      return (urlAccountId ?? "").trim();
    }
    return resolveSelectedAccountId(connectedIds, {
      urlAccountId,
      ...options?.scopeDefaults,
    });
  }, [accountsReady, connectedIds, options?.scopeDefaults, urlAccountId]);

  const activeAccount = useMemo(
    () => connectedAccounts.find((account) => account.id === accountId) ?? connectedAccounts[0],
    [accountId, connectedAccounts],
  );

  const effectiveAccountId = accountId || activeAccount?.id || "";

  useEffect(() => {
    if (!accountsReady || !effectiveAccountId || holdUrlSync) return;

    writeStoredSelectedAccountId(effectiveAccountId);

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
  }, [accountsReady, effectiveAccountId, holdUrlSync, searchParams, setSearchParams]);

  const setAccountId = useCallback(
    (id: string, options?: SetAccountIdOptions) => {
      writeStoredSelectedAccountId(id);
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
    [setSearchParams],
  );

  return { accountId: effectiveAccountId, activeAccount, setAccountId };
}
