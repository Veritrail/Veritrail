import { api, isSessionStaleError, PENDING_INVITE_KEY } from "../api";
import { accountListSchema, meSchema } from "./apiSchemas";
import { isAccountConnected } from "./accountConnection";

export const NO_WORKSPACE_PATH = "/no-workspace";

/** Where to land after login — checks workspace membership before app routes. */
export async function postAuthPath(): Promise<string> {
  const me = await api("/v1/auth/me", { schema: meSchema });
  if (!me.has_workspace) {
    const pendingInvite = sessionStorage.getItem(PENDING_INVITE_KEY);
    if (pendingInvite) return `/invite/${pendingInvite}`;
    return NO_WORKSPACE_PATH;
  }

  try {
    const accounts = await api("/v1/accounts", { schema: accountListSchema });
    if (accounts.some(isAccountConnected)) return "/findings";
  } catch (e) {
    // api() already cleared tokens and scheduled /login when the session is dead.
    if (isSessionStaleError(e)) throw e;
    // If accounts cannot load, onboarding is still the safest default.
  }
  return "/accounts";
}

/** Routes reachable before a connected AWS account exists. */
export const ACCOUNT_OPTIONAL_PATHS = new Set(["/accounts", "/account", "/profile"]);

export function pathRequiresConnectedAccount(pathname: string): boolean {
  return !ACCOUNT_OPTIONAL_PATHS.has(pathname);
}
