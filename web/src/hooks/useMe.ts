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

export function useMe() {
  return useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api("/v1/auth/me", { schema: meSchema }),
    staleTime: 60_000,
  });
}
