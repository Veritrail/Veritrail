export const SELECTED_ACCOUNT_STORAGE_KEY = "veritrail.selectedAccountId";

export function readStoredSelectedAccountId(): string {
  try {
    return sessionStorage.getItem(SELECTED_ACCOUNT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeStoredSelectedAccountId(id: string): void {
  try {
    if (id) sessionStorage.setItem(SELECTED_ACCOUNT_STORAGE_KEY, id);
    else sessionStorage.removeItem(SELECTED_ACCOUNT_STORAGE_KEY);
  } catch {
    /* sessionStorage unavailable */
  }
}

export function accountIdFromSearchParams(params: URLSearchParams): string | null {
  return params.get("account_id") || params.get("account") || null;
}

/** URL account wins, then sessionStorage, then first connected account. */
export function resolveSelectedAccountId(
  connectedIds: readonly string[],
  options: { urlAccountId?: string | null; storedAccountId?: string | null } = {},
): string {
  const url = (options.urlAccountId ?? "").trim();
  if (url && connectedIds.includes(url)) return url;

  const stored = (options.storedAccountId ?? readStoredSelectedAccountId()).trim();
  if (stored && connectedIds.includes(stored)) return stored;

  return connectedIds[0] ?? "";
}
