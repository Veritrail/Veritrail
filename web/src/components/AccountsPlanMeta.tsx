import {
  formatAccountLimitText,
  formatPlanDisplayLabel,
} from "../hooks/useAccountsPlanUsage";

type AccountsPlanMetaProps = {
  planLabel?: string;
  used: number;
  maxAccounts: number | null;
  loading?: boolean;
  className?: string;
};

/**
 * Subtle workspace plan + connected-account limit row for the Accounts page.
 */
export default function AccountsPlanMeta({
  planLabel,
  used,
  maxAccounts,
  loading = false,
  className = "",
}: AccountsPlanMetaProps) {
  if (loading) {
    return (
      <p className={`accounts-plan-meta accounts-plan-meta--loading${className ? ` ${className}` : ""}`}>
        Loading plan details…
      </p>
    );
  }

  const plan = formatPlanDisplayLabel(planLabel);
  const limit = formatAccountLimitText(used, maxAccounts);
  if (!plan && !limit) return null;

  return (
    <p className={`accounts-plan-meta${className ? ` ${className}` : ""}`}>
      {plan ? <span className="accounts-plan-meta__plan">{plan}</span> : null}
      {plan && limit ? <span className="accounts-plan-meta__sep" aria-hidden>·</span> : null}
      {limit ? <span className="accounts-plan-meta__limit">{limit}</span> : null}
    </p>
  );
}
