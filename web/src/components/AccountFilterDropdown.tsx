import { HistoryFilterDropdown } from "./HistoryFilterDropdown";
import { groupAccountId, type AccountOption } from "./AccountSelect";
import { AWS_LOGO_LIGHT } from "../lib/awsBrand";
import "../styles/history-page.css";

/**
 * Account picker for Findings / Compliance. Reuses the same dropdown "card
 * family" as the History filters (labeled box + portalled checkmark menu) so
 * the account selector looks identical across every page.
 */
export function AccountFilterDropdown({
  accounts,
  value,
  onChange,
}: {
  accounts: AccountOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (accounts.length === 0) return null;
  const awsLogo = (className: string) => (
    <img src={AWS_LOGO_LIGHT} alt="" className={className} width={30} height={19} />
  );
  return (
    <HistoryFilterDropdown
      label="Account"
      ariaLabel="Account"
      boxClassName="history-filter-box--account"
      value={value}
      options={accounts.map((a) => ({ value: a.id, label: a.label || groupAccountId(a.account_id ?? "") }))}
      onChange={onChange}
      valueIcon={awsLogo("history-filter-box__aws")}
      optionIcon={() => awsLogo("history-filter-menu__icon history-filter-menu__aws")}
    />
  );
}
