import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { planUsageSchema } from "../lib/apiSchemas";

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
    queryFn: () => api("/v1/accounts/plan-usage", { schema: planUsageSchema }),
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

/** Compact label above the sidebar accounts progress bar. */
export function formatSidebarAccountsLabel(used: number, maxAccounts: number | null): string {
  if (maxAccounts == null) {
    const noun = used === 1 ? "account" : "accounts";
    return `${used} ${noun} connected`;
  }
  const limitNoun = maxAccounts === 1 ? "account" : "accounts";
  return `${used} out of ${maxAccounts} ${limitNoun} connected`;
}

/** Screen-reader label for the sidebar accounts progress bar. */
export function formatSidebarAccountsStatus(
  used: number,
  maxAccounts: number | null,
  planLabel?: string,
): string {
  const plan = formatPlanDisplayLabel(planLabel) ?? "org plan";
  if (maxAccounts == null) {
    const noun = used === 1 ? "account" : "accounts";
    return `${used} ${noun} connected (${plan})`;
  }
  const limitNoun = maxAccounts === 1 ? "account" : "accounts";
  return `${used} out of ${maxAccounts} ${limitNoun} connected (${plan})`;
}

/** Fill percentage for the sidebar accounts progress bar (0–100). */
export function getSidebarAccountsBarFill(used: number, maxAccounts: number | null): number {
  if (maxAccounts == null) return 100;
  if (maxAccounts <= 0) return 0;
  return Math.min(100, (used / maxAccounts) * 100);
}
