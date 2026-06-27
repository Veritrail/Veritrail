import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export type AccountsPlanUsage = {
  plan: string;
  plan_label: string;
  max_accounts: number | null;
  used: number;
  can_add: boolean;
};

export function useAccountsPlanUsage() {
  return useQuery({
    queryKey: ["accounts-plan-usage"],
    queryFn: () => api<AccountsPlanUsage>("/v1/accounts/plan-usage"),
    staleTime: 60_000,
  });
}

export function formatPlanDisplayLabel(planLabel: string | undefined): string | null {
  const trimmed = planLabel?.trim();
  if (!trimmed) return null;
  return /plan$/i.test(trimmed) ? trimmed : `${trimmed} plan`;
}

/** Tier name for compact badges (drops a trailing "plan" suffix). */
export function formatPlanBadgeLabel(planLabel: string | undefined): string | null {
  const trimmed = planLabel?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\s+plan$/i, "");
}

export function formatAccountLimitText(used: number, maxAccounts: number | null): string {
  if (maxAccounts == null) {
    return used === 1 ? "1 account · unlimited" : `${used} accounts · unlimited`;
  }
  const noun = maxAccounts === 1 ? "account" : "accounts";
  return `${used} of ${maxAccounts} ${noun}`;
}
