import { api, isSessionStaleError } from "../api";
import { accountListSchema } from "./apiSchemas";
import { isAccountConnected } from "./accountConnection";

/** Where to land after login when the user may have zero connected AWS accounts. */
export async function postAuthPath(): Promise<"/accounts" | "/findings"> {
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
