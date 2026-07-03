import type { z } from "zod";

import { accessTokenSchema, parseApiResponse, warnMissingSchema } from "./lib/apiSchemas";

/** Empty VITE_API_URL uses same-origin `/v1` (Vite dev proxy → API). */
export const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? "";

export type { ApiValidationError } from "./lib/apiSchemas";
export { parseApiResponse, warnMissingSchema } from "./lib/apiSchemas";

export type ApiInit<T = unknown> = RequestInit & {
  /** When set, response JSON is validated at the fetch boundary. */
  schema?: z.ZodType<T>;
};

const ACCESS_KEY = "veritrail_access_token";
const AUDITOR_KEY = "veritrail_auditor_token";
export const SIGNED_OUT_KEY = "veritrail_signed_out";
const PENDING_INVITE_KEY = "veritrail_pending_invite_token";
const PENDING_CREDENTIALS_KEY = "veritrail_pending_credentials";
const MFA_STORAGE_KEY = "veritrail_mfa_token";

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

/** Clear SPA auth leftovers after explicit sign-out. */
export function markSignedOut() {
  sessionStorage.setItem(SIGNED_OUT_KEY, "1");
  sessionStorage.removeItem(PENDING_INVITE_KEY);
  sessionStorage.removeItem(PENDING_CREDENTIALS_KEY);
  sessionStorage.removeItem(MFA_STORAGE_KEY);
}

export function consumeSignedOut(): boolean {
  const signedOut = sessionStorage.getItem(SIGNED_OUT_KEY) === "1";
  if (signedOut) sessionStorage.removeItem(SIGNED_OUT_KEY);
  return signedOut;
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

/** True when the API indicates JWT user/org no longer match the database. */
export function isSessionStaleError(error: unknown): boolean {
  const msg = formatApiError(error).toLowerCase();
  return (
    msg.includes("session stale") ||
    msg.includes("session expired") ||
    msg.includes("organization not found") ||
    msg.includes("user not found") ||
    msg.includes("org mismatch")
  );
}

let _refreshing: Promise<string | null> | null = null;

const REFRESH_TIMEOUT_MS = 15_000;

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REFRESH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

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
      const res = await fetchWithTimeout(`${BASE}/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ refresh_token: "" }),
      });
      if (!res.ok) return null;
      const data = parseApiResponse("/v1/auth/refresh", accessTokenSchema, await res.json());
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

async function readJsonResponse<T>(path: string, res: Response, schema?: z.ZodType<T>): Promise<T> {
  const data: unknown = await res.json();
  if (schema) return parseApiResponse(path, schema, data);
  return data as T;
}

export async function api<T = unknown>(path: string, init: ApiInit<T> = {}): Promise<T> {
  const { schema, ...fetchInit } = init;
  warnMissingSchema(path, init);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchInit.headers as Record<string, string> | undefined),
  };
  const t = token();
  if (t) headers["Authorization"] = `Bearer ${t}`;
  const res = await fetch(`${BASE}${path}`, { ...fetchInit, headers, credentials: "include" });

  if (res.status === 401 && t) {
    const newToken = await tryRefresh();
    if (newToken) {
      const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` };
      const retry = await fetch(`${BASE}${path}`, {
        ...fetchInit,
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
      return readJsonResponse(path, retry, schema);
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
  return readJsonResponse(path, res, schema);
}

export async function apiUpload<T = unknown>(
  path: string,
  form: FormData,
  schema?: z.ZodType<T>,
): Promise<T> {
  const headers: Record<string, string> = {};
  const t = token();
  if (t) headers["Authorization"] = `Bearer ${t}`;
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    body: form,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(parseApiError(res.status, body));
  }
  return readJsonResponse(path, res, schema);
}

/** Unauthenticated public API routes (`/trust`, `/auditor`). */
export async function publicApi<T = unknown>(path: string, init: ApiInit<T> = {}): Promise<T> {
  const { schema, ...fetchInit } = init;
  const res = await fetch(`${BASE}${path}`, fetchInit);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(parseApiError(res.status, body));
  }
  return readJsonResponse(path, res, schema);
}

export async function logout(): Promise<void> {
  markSignedOut();
  try {
    await fetch(`${BASE}/v1/auth/logout`, { method: "POST", credentials: "include" });
  } finally {
    clearTokens();
  }
}

/** Auditor-scoped API call using auditor JWT. Does not auto-refresh. */
export async function auditorApi<T = unknown>(path: string, init: ApiInit<T> = {}): Promise<T> {
  const { schema, ...fetchInit } = init;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchInit.headers as Record<string, string> | undefined),
  };
  const t = auditorToken();
  if (t) headers["Authorization"] = `Bearer ${t}`;
  const res = await fetch(`${BASE}${path}`, { ...fetchInit, headers, credentials: "include" });
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
  return readJsonResponse(path, res, schema);
}
