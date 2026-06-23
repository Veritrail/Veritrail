const BLOCKED_HOST_SUFFIXES = [".local", ".internal"];

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost") return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((part) => part > 255)) return false;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export function isSafeExternalImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    if (!host || isBlockedHost(host) || isPrivateIpv4(host)) return false;
    if (host.includes(":")) return false;
    return true;
  } catch {
    return false;
  }
}

export function sanitizeExternalImageUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  return isSafeExternalImageUrl(url) ? url.trim() : null;
}

/** Resolve stored upload paths or HTTPS logo URLs for <img src>. */
export function resolveTrustLogoUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const cleaned = url.trim();
  if (cleaned.startsWith("/uploads/trust-logos/")) {
    const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? "";
    return `${apiBase}${cleaned}`;
  }
  return sanitizeExternalImageUrl(cleaned);
}
