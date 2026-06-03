/** Public web app origin for links shared with users (not the API). */
export function getAppOrigin(): string {
  const fromEnv = (import.meta.env.VITE_FRONTEND_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost:5173";
}

export function auditorVerifyUrl(accessToken: string): string {
  return `${getAppOrigin()}/auditor/verify/${accessToken}`;
}

export function trustCenterPublicUrl(slug: string): string {
  return `${getAppOrigin()}/trust/${slug}`;
}
