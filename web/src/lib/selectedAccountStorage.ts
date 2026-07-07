import { ALL_CLOUD_SCOPE_ID, IDENTITY_SCOPE_ID, SOURCE_CONTROL_SCOPE_ID } from "../hooks/useConnectedAccountOptions";

export const SELECTED_ACCOUNT_STORAGE_KEY = "veritrail.selectedAccountId";

export type ResolveSelectedAccountOptions = {
  urlAccountId?: string | null;
  storedAccountId?: string | null;
  /** When ≥1 cloud account exists, default org-level cloud scope. */
  cloudAccountCount?: number;
  /** SCM-only org fallback when cloudAccountCount is 0. */
  hasSourceControl?: boolean;
  /** Identity integration fallback when cloud + SCM scopes unavailable. */
  hasIdentity?: boolean;
};

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

/** URL wins, then sessionStorage, then org-level scope defaults when configured. */
export function resolveSelectedAccountId(
  connectedIds: readonly string[],
  options: ResolveSelectedAccountOptions = {},
): string {
  const url = (options.urlAccountId ?? "").trim();
  if (url && connectedIds.includes(url)) return url;

  const stored = (options.storedAccountId ?? readStoredSelectedAccountId()).trim();
  if (stored && connectedIds.includes(stored)) return stored;

  const cloudCount = options.cloudAccountCount;
  if (cloudCount != null) {
    if (cloudCount >= 1) return ALL_CLOUD_SCOPE_ID;
    if (options.hasSourceControl) return SOURCE_CONTROL_SCOPE_ID;
    if (options.hasIdentity) return IDENTITY_SCOPE_ID;
  }

  return connectedIds[0] ?? "";
}
