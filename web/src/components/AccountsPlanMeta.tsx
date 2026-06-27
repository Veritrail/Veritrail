import {
  formatAccountLimitText,
  formatPlanBadgeLabel,
  formatPlanDisplayLabel,
} from "../hooks/useAccountsPlanUsage";

type AccountsPlanMetaProps = {
  planLabel?: string;
  used: number;
  maxAccounts: number | null;
  loading?: boolean;
  className?: string;
};

function usageProgressPercent(used: number, maxAccounts: number | null): number | null {
  if (maxAccounts == null || maxAccounts <= 0) return null;
  return Math.min(100, Math.round((used / maxAccounts) * 100));
}

/**
 * Compact workspace plan + account limit chip for the Accounts list toolbar.
 */
export default function AccountsPlanMeta({
  planLabel,
  used,
  maxAccounts,
  loading = false,
  className = "",
}: AccountsPlanMetaProps) {
  const rootClass = ["accounts-plan-chip", className].filter(Boolean).join(" ");

  if (loading) {
    return (
      <div className={`${rootClass} accounts-plan-chip--loading`} aria-busy="true">
        <span className="accounts-plan-chip__skeleton" />
      </div>
    );
  }

  const plan = formatPlanDisplayLabel(planLabel);
  const badge = formatPlanBadgeLabel(planLabel);
  const limitText = formatAccountLimitText(used, maxAccounts);
  if (!plan && !limitText) return null;

  const progress = usageProgressPercent(used, maxAccounts);
  const atCap = maxAccounts != null && used >= maxAccounts;

  return (
    <div
      className={`${rootClass}${atCap ? " accounts-plan-chip--at-cap" : ""}`}
      aria-label={limitText ? `${plan ?? "Workspace plan"}, ${limitText}` : plan ?? undefined}
    >
      <div className="accounts-plan-chip__row">
        {badge ? <span className="accounts-plan-chip__badge">{badge}</span> : null}
        <div className="accounts-plan-chip__usage">
          <span className="accounts-plan-chip__count">{used}</span>
          {maxAccounts != null ? (
            <>
              <span className="accounts-plan-chip__sep" aria-hidden>
                /
              </span>
              <span className="accounts-plan-chip__max">{maxAccounts}</span>
            </>
          ) : (
            <span className="accounts-plan-chip__unlimited">unlimited</span>
          )}
        </div>
      </div>
      {progress != null ? (
        <div
          className="accounts-plan-chip__progress"
          role="progressbar"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={maxAccounts ?? undefined}
          aria-label={`${used} of ${maxAccounts} accounts used`}
        >
          <span className="accounts-plan-chip__progress-fill" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
    </div>
  );
}
