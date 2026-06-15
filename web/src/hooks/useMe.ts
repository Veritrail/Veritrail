import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export type OrgRole = "owner" | "admin" | "editor" | "viewer";

export type Me = {
  id: string;
  email: string;
  role: OrgRole;
  org_id: string;
};

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
    queryFn: () => api<Me>("/v1/auth/me"),
    staleTime: 60_000,
  });
}
