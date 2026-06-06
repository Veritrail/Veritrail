/** Empty VITE_API_URL uses same-origin `/v1` (Vite dev proxy → API). */
export const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? "";

const ACCESS_KEY = "vigil_access_token";
const AUDITOR_KEY = "vigil_auditor_token";

/** Short-lived access token in sessionStorage (refresh is HttpOnly cookie). */
export function token(): string | null {
  return sessionStorage.getItem(ACCESS_KEY);
}

/** Auditor JWT token. */
export function auditorToken(): string | null {
  return sessionStorage.getItem(AUDITOR_KEY);
}

export function storeAuditorToken(access: string) {
  sessionStorage.setItem(AUDITOR_KEY, access);
}

export function clearAuditorToken() {
  sessionStorage.removeItem(AUDITOR_KEY);
}

export function storeAccessToken(access: string) {
  sessionStorage.setItem(ACCESS_KEY, access);
}

/** @deprecated refresh is HttpOnly; kept for OAuth transition */
export function storeTokens(access: string, _refresh?: string) {
  storeAccessToken(access);
}

export function clearTokens() {
  sessionStorage.removeItem(ACCESS_KEY);
}

function parseApiError(_status: number, body: string): string {
  let text = body.trim().replace(/^\d{3}:\s*/, "");
  try {
    const json = JSON.parse(text) as { detail?: unknown };
    const detail = json.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "msg" in item) {
            return String((item as { msg: unknown }).msg);
          }
          return String(item);
        })
        .join("; ");
    }
  } catch {
    // not JSON — fall through
  }
  if (text.startsWith("{")) return "Something went wrong. Try again.";
  return text || "Something went wrong. Try again.";
}

/** Turn API/ thrown errors into user-facing copy (no status codes or JSON blobs). */
export function formatApiError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const msg = parseApiError(0, raw);
  if (!msg) return "Something went wrong. Try again.";
  return msg.charAt(0).toUpperCase() + msg.slice(1);
}

let _refreshing: Promise<string | null> | null = null;

/** Restore session from HttpOnly refresh cookie when access token is gone. */
export async function restoreSession(): Promise<boolean> {
  if (token()) return true;
  const refreshed = await tryRefresh();
  return Boolean(refreshed);
}

async function tryRefresh(): Promise<string | null> {
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    try {
      const res = await fetch(`${BASE}/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ refresh_token: "" }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { access_token: string };
      storeAccessToken(data.access_token);
      return data.access_token;
    } catch {
      return null;
    } finally {
      _refreshing = null;
    }
  })();
  return _refreshing;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  const t = token();
  if (t) headers["Authorization"] = `Bearer ${t}`;
  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: "include" });

  if (res.status === 401 && t) {
    const newToken = await tryRefresh();
    if (newToken) {
      const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` };
      const retry = await fetch(`${BASE}${path}`, {
        ...init,
        headers: retryHeaders,
        credentials: "include",
      });
      if (retry.status === 401) {
        clearTokens();
        window.location.href = "/login";
        throw new Error("session expired");
      }
      if (!retry.ok) {
        const body = await retry.text();
        throw new Error(parseApiError(retry.status, body));
      }
      if (retry.status === 204) return undefined as T;
      return retry.json() as Promise<T>;
    }
    clearTokens();
    window.location.href = "/login";
    throw new Error("session expired");
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(parseApiError(res.status, body));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${BASE}/v1/auth/logout`, { method: "POST", credentials: "include" });
  } finally {
    clearTokens();
  }
}

/** Auditor-scoped API call using auditor JWT. Does not auto-refresh. */
export async function auditorApi<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  const t = auditorToken();
  if (t) headers["Authorization"] = `Bearer ${t}`;
  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: "include" });
  if (res.status === 401) {
    clearAuditorToken();
    window.location.href = "/auditor/login";
    throw new Error("auditor session expired");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(parseApiError(res.status, body));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
