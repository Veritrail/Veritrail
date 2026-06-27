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

function planInitial(planLabel: string | undefined): string | null {
  const badge = formatPlanBadgeLabel(planLabel);
  if (!badge) return null;
  return badge.charAt(0).toUpperCase();
}

function accountUsageSubtitle(used: number, maxAccounts: number | null): string | null {
  const limitText = formatAccountLimitText(used, maxAccounts);
  if (!limitText) return null;
  if (maxAccounts == null) return limitText;
  return `${limitText} connected`;
}

/**
 * Workspace plan + account limit card for the Accounts list header.
 * Mirrors the sidebar collapsed workspace identity card (dark compact card).
 */
export default function AccountsPlanMeta({
  planLabel,
  used,
  maxAccounts,
  loading = false,
  className = "",
}: AccountsPlanMetaProps) {
  const rootClass = ["accounts-plan-card", className].filter(Boolean).join(" ");

  if (loading) {
    return (
      <div className={`${rootClass} accounts-plan-card--loading`} aria-busy="true">
        <span className="accounts-plan-card__badge accounts-plan-card__badge--skeleton" aria-hidden />
        <span className="accounts-plan-card__copy">
          <span className="accounts-plan-card__skeleton-line accounts-plan-card__skeleton-line--title" />
          <span className="accounts-plan-card__skeleton-line accounts-plan-card__skeleton-line--subtitle" />
        </span>
      </div>
    );
  }

  const plan = formatPlanDisplayLabel(planLabel);
  const initial = planInitial(planLabel);
  const subtitle = accountUsageSubtitle(used, maxAccounts);
  if (!plan && !subtitle) return null;

  const progress = usageProgressPercent(used, maxAccounts);
  const atCap = maxAccounts != null && used >= maxAccounts;
  const ariaLabel = subtitle ? `${plan ?? "Workspace plan"}, ${subtitle}` : plan ?? undefined;

  return (
    <div
      className={`${rootClass}${atCap ? " accounts-plan-card--at-cap" : ""}`}
      aria-label={ariaLabel}
    >
      <span className="accounts-plan-card__badge" aria-hidden>
        {initial ?? "P"}
      </span>
      <span className="accounts-plan-card__copy">
        {plan ? <span className="accounts-plan-card__title">{plan}</span> : null}
        {subtitle ? <span className="accounts-plan-card__subtitle">{subtitle}</span> : null}
        {progress != null ? (
          <span
            className="accounts-plan-card__progress"
            role="progressbar"
            aria-valuenow={used}
            aria-valuemin={0}
            aria-valuemax={maxAccounts ?? undefined}
            aria-label={`${used} of ${maxAccounts} accounts used`}
          >
            <span className="accounts-plan-card__progress-fill" style={{ width: `${progress}%` }} />
          </span>
        ) : null}
      </span>
    </div>
  );
}
