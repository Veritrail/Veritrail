export function orgInitials(orgName: string): string {
  const words = orgName.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
  return orgName.trim().slice(0, 2).toUpperCase() || "WS";
}

export function userInitials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  if (parts[0]?.length >= 2) return parts[0].slice(0, 2).toUpperCase();
  return local.slice(0, 2).toUpperCase() || "?";
}

export function userDisplayName(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
  }
  if (!local) return email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/** Prefer API-provided display_name, then formatted email local part. */
export function resolveUserDisplayName(
  email: string,
  displayName?: string | null,
): string {
  const stored = displayName?.trim();
  if (stored) return stored;
  return userDisplayName(email);
}

export function userInitialsFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
  }
  if (words[0]?.length >= 2) return words[0].slice(0, 2).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase() || "?";
}
