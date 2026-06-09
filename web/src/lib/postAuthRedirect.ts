import { api } from "../api";
import { isAccountConnected } from "./accountConnection";

type AccountRow = { status: string; account_id: string | null };

/** Where to land after login when the user may have zero connected AWS accounts. */
export async function postAuthPath(): Promise<"/accounts" | "/findings"> {
  try {
    const accounts = await api<AccountRow[]>("/v1/accounts");
    if (accounts.some(isAccountConnected)) return "/findings";
  } catch {
    // If accounts cannot load, onboarding is still the safest default.
  }
  return "/accounts";
}

/** Routes reachable before a connected AWS account exists. */
export const ACCOUNT_OPTIONAL_PATHS = new Set(["/accounts", "/account"]);

export function pathRequiresConnectedAccount(pathname: string): boolean {
  return !ACCOUNT_OPTIONAL_PATHS.has(pathname);
}
