import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { meSchema, type Me } from "../lib/apiSchemas";

export type OrgRole = Me["role"];

const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

export function roleAtLeast(role: OrgRole | undefined, minimum: OrgRole): boolean {
  if (!role) return false;
  return (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[minimum] ?? 0);
}

/** Human-readable workspace role for UI (e.g. admin → Admin, security_engineer → Security Engineer). */
export function formatOrgRole(role: string | undefined | null): string | null {
  const trimmed = role?.trim();
  if (!trimmed) return null;
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(trimmed)) {
    return trimmed
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function useMe() {
  return useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api("/v1/auth/me", { schema: meSchema }),
    staleTime: 60_000,
  });
}
